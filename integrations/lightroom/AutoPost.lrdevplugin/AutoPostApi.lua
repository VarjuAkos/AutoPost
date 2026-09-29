local LrHttp = import 'LrHttp'
local LrPasswords = import 'LrPasswords'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'
local logger = import 'LrLogger' ('AutoPost')
logger:enable('logfile')

local AutoPostApi = {}
local TOKEN_KEY = 'dev.autopost.lightroom.token'
local LR_TIMEOUT = 120
local MAX_KEYWORD_BYTES = 3000

-- Tokens live in the macOS Keychain, never in publish presets or the catalog.
function AutoPostApi.storeToken(token)
	LrPasswords.store(TOKEN_KEY, token)
end

function AutoPostApi.hasToken()
	local token = LrPasswords.retrieve(TOKEN_KEY)
	return token ~= nil and token ~= ''
end

local function jsonString(value)
	local escaped = value:gsub('[%c"\\]', function(c)
		local map = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
		return map[c] or string.format('\\u%04x', c:byte())
	end)
	return '"' .. escaped .. '"'
end

local function encode(value)
	local kind = type(value)
	if value == nil then return 'null' end
	if kind == 'boolean' then return value and 'true' or 'false' end
	if kind == 'number' then
		if value ~= value or value == math.huge or value == -math.huge then return 'null' end
		if value == math.floor(value) then return string.format('%d', value) end
		return string.format('%.3f', value)
	end
	if kind == 'string' then return jsonString(value) end
	if kind == 'table' and value.__array then
		local parts = {}
		for _, item in ipairs(value) do table.insert(parts, encode(item)) end
		return '[' .. table.concat(parts, ',') .. ']'
	end
	if kind == 'table' and value.__keys then
		local parts = {}
		for _, key in ipairs(value.__keys) do table.insert(parts, jsonString(key) .. ':' .. encode(value[key])) end
		return '{' .. table.concat(parts, ',') .. '}'
	end
	error('Unsupported JSON value: ' .. kind)
end

function AutoPostApi.array(items)
	items.__array = true
	return items
end

function AutoPostApi.object(keys, values)
	values.__keys = keys
	return values
end

AutoPostApi.encode = encode

function AutoPostApi.splitKeywords(text)
	local keywords, total = AutoPostApi.array({}), 0
	if not text or text == '' then return keywords end
	for part in string.gmatch(text, '([^,]+)') do
		local keyword = part:gsub('^%s+', ''):gsub('%s+$', ''):sub(1, 100)
		if keyword ~= '' and #keywords < 100 and total + #keyword <= MAX_KEYWORD_BYTES then
			table.insert(keywords, keyword)
			total = total + #keyword
		end
	end
	return keywords
end

function AutoPostApi.baseUrl(settings)
	local url = (settings and settings.serverUrl) or 'http://127.0.0.1:3000'
	url = url:gsub('/+$', '')
	if not (url:match('^http://127%.0%.0%.1:%d+$') or url:match('^http://localhost:%d+$')) then
		error('AutoPost only accepts a local address such as http://127.0.0.1:3000')
	end
	return url
end

local function field(body, name)
	if not body then return nil end
	return body:match('"' .. name .. '"%s*:%s*"(.-)"')
end

local function describe(body, headers)
	if not body then
		return 'AutoPost is not reachable. Make sure the app is running (npm run dev) and the address is correct.'
	end
	local message = field(body, 'error')
	local status = headers and headers.status or 0
	if status == 401 then return 'Lightroom is not paired. Generate a token in AutoPost (Connect Lightroom) and paste it in the publish service settings.' end
	return message or ('AutoPost request failed (HTTP ' .. tostring(status) .. ').')
end

local function authHeaders(extra)
	local token = LrPasswords.retrieve(TOKEN_KEY)
	if not token or token == '' then
		error('Lightroom is not paired. Generate a token in AutoPost (Connect Lightroom) and paste it in the publish service settings.')
	end
	local headers = { { field = 'Authorization', value = 'Bearer ' .. token } }
	for _, header in ipairs(extra or {}) do table.insert(headers, header) end
	return headers
end

-- Performs a request, retrying briefly while AutoPost is busy importing another photo.
local function request(settings, method, path, body, extraHeaders)
	local url = AutoPostApi.baseUrl(settings) .. '/api/integrations/lightroom/' .. path
	for attempt = 1, 6 do
		local responseBody, headers
		if method == 'GET' then
			responseBody, headers = LrHttp.get(url, authHeaders(extraHeaders), LR_TIMEOUT)
		elseif method == 'MULTIPART' then
			responseBody, headers = LrHttp.postMultipart(url, body, authHeaders(extraHeaders), LR_TIMEOUT)
		else
			responseBody, headers = LrHttp.post(url, body or '', authHeaders(extraHeaders), 'POST', LR_TIMEOUT)
		end
		local status = headers and headers.status or 0
		if status >= 200 and status < 300 then return responseBody end
		if status ~= 429 or attempt == 6 then
			local message = describe(responseBody, headers)
			logger:warn(string.format('%s %s failed: %s', method, path, message))
			error(message)
		end
		LrTasks.sleep(attempt)
	end
end

function AutoPostApi.ping(settings)
	local body = request(settings, 'GET', 'ping')
	if not (body and body:match('"app"%s*:%s*"autopost"')) then error('The server at this address is not AutoPost.') end
	return true
end

-- Streams the rendered JPEG from Lightroom's temporary export folder; the file is only read.
function AutoPostApi.publishPhoto(settings, filePath, metadata)
	local body = request(settings, 'MULTIPART', 'photos', {
		{ name = 'metadata', value = encode(metadata) },
		{ name = 'photo', fileName = LrPathUtils.leafName(filePath), filePath = filePath, contentType = 'image/jpeg' },
	})
	local assetId = field(body, 'assetId')
	if not assetId or not assetId:match('^[%x%-]+$') then error('AutoPost did not return a photo ID for ' .. tostring(filePath)) end
	return assetId
end

function AutoPostApi.unlinkPhotos(settings, assetIds)
	local ids = AutoPostApi.array({})
	for _, id in ipairs(assetIds) do table.insert(ids, id) end
	request(settings, 'POST', 'photos/unlink', encode(AutoPostApi.object({ 'assetIds' }, { assetIds = ids })), { { field = 'Content-Type', value = 'application/json' } })
end

function AutoPostApi.updateCollection(settings, collectionId, name, action)
	local payload = AutoPostApi.object({ 'lrCollectionId', 'name', 'action' }, { lrCollectionId = tostring(collectionId), name = name, action = action })
	request(settings, 'POST', 'collections', encode(payload), { { field = 'Content-Type', value = 'application/json' } })
end

return AutoPostApi
