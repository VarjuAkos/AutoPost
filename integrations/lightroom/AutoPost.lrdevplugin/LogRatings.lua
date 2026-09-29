local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'
local logger = import 'LrLogger' ('AutoPost')
logger:enable('logfile')

local MAX_LOGGED = 200

LrTasks.startAsyncTask(function()
	local catalog = LrApplication.activeCatalog()
	local photos = catalog:getTargetPhotos()
	if #photos == 0 then
		LrDialogs.message('AutoPost', 'Select one or more photos first.', 'info')
		return
	end
	local raw = catalog:batchGetRawMetadata(photos, { 'rating', 'uuid', 'dateTimeOriginal' })
	local formatted = catalog:batchGetFormattedMetadata(photos, { 'fileName' })
	local counts = { [0] = 0, 0, 0, 0, 0, 0 }
	logger:info(string.format('Logging ratings for %d photo(s)', #photos))
	for index, photo in ipairs(photos) do
		local rating = raw[photo].rating or 0
		counts[rating] = (counts[rating] or 0) + 1
		if index <= MAX_LOGGED then
			logger:info(string.format('%s rating=%d uuid=%s dateTimeOriginal=%s', tostring(formatted[photo].fileName), rating, tostring(raw[photo].uuid), tostring(raw[photo].dateTimeOriginal)))
		end
	end
	local lines = { string.format('%d photo(s) selected', #photos) }
	for stars = 5, 0, -1 do
		table.insert(lines, string.format('%s: %d', stars == 0 and 'Unrated' or string.rep('*', stars), counts[stars] or 0))
	end
	if #photos > MAX_LOGGED then table.insert(lines, string.format('(Only the first %d are written to the log.)', MAX_LOGGED)) end
	LrDialogs.message('AutoPost ratings', table.concat(lines, '\n'), 'info')
end)
