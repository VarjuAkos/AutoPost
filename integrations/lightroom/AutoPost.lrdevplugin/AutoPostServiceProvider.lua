local LrDialogs = import 'LrDialogs'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'
local logger = import 'LrLogger' ('AutoPost')
logger:enable('logfile')

local AutoPostApi = require 'AutoPostApi'
local bind = LrView.bind

local provider = {}

provider.supportsIncrementalPublish = 'only'
provider.canExportVideo = false
provider.supportsCustomSortOrder = false
provider.allowFileFormats = { 'JPEG' }
provider.allowColorSpaces = { 'sRGB' }
provider.hidePrintResolution = true
-- The export location is hidden so renders always go to Lightroom's temporary folder,
-- never to a photo folder.
provider.hideSections = { 'exportLocation', 'fileNaming', 'video' }
provider.exportPresetFields = {
	{ key = 'serverUrl', default = 'http://127.0.0.1:3000' },
}
provider.titleForGoToPublishedCollection = 'disable'
provider.titleForGoToPublishedPhoto = 'disable'

function provider.updateExportSettings(exportSettings)
	exportSettings.LR_format = 'JPEG'
	exportSettings.LR_export_colorSpace = 'sRGB'
	exportSettings.LR_jpeg_quality = exportSettings.LR_jpeg_quality or 0.9
	exportSettings.LR_embeddedMetadataOption = 'copyrightOnly'
	exportSettings.LR_removeLocationMetadata = true
end

function provider.startDialog(propertyTable)
	propertyTable.autopostTokenInput = ''
	propertyTable.autopostStatus = AutoPostApi.hasToken() and 'Paired (token saved in the macOS Keychain).' or 'Not paired yet.'
end

local function saveTokenInput(propertyTable)
	local token = (propertyTable.autopostTokenInput or ''):gsub('^%s+', ''):gsub('%s+$', '')
	if token ~= '' then
		AutoPostApi.storeToken(token)
		propertyTable.autopostTokenInput = ''
	end
end

function provider.endDialog(propertyTable, why)
	if why == 'ok' then saveTokenInput(propertyTable) end
end

function provider.sectionsForTopOfDialog(f, propertyTable)
	return {
		{
			title = 'AutoPost',
			synopsis = bind 'serverUrl',
			f:row {
				f:static_text { title = 'AutoPost address:', width = LrView.share 'autopost_label' },
				f:edit_field { value = bind 'serverUrl', width_in_chars = 28, immediate = true },
			},
			f:row {
				f:static_text { title = 'Pairing token:', width = LrView.share 'autopost_label' },
				f:password_field { value = bind 'autopostTokenInput', width_in_chars = 28, immediate = true },
			},
			f:row {
				f:static_text { title = '', width = LrView.share 'autopost_label' },
				f:static_text { title = 'Generate it in AutoPost via "Connect Lightroom". Leave empty to keep the saved token.', fill_horizontal = 1 },
			},
			f:row {
				f:static_text { title = '', width = LrView.share 'autopost_label' },
				f:push_button {
					title = 'Test connection',
					action = function()
						LrTasks.startAsyncTask(function()
							saveTokenInput(propertyTable)
							local ok, message = LrTasks.pcall(AutoPostApi.ping, propertyTable)
							propertyTable.autopostStatus = ok and 'Connected to AutoPost.' or tostring(message)
						end)
					end,
				},
				f:static_text { title = bind 'autopostStatus', fill_horizontal = 1 },
			},
		},
	}
end

function provider.getCollectionBehaviorInfo(publishSettings)
	return {
		defaultCollectionName = 'AutoPost',
		defaultCollectionCanBeDeleted = true,
		canAddCollection = true,
		maxCollectionSetDepth = 0,
	}
end

function provider.metadataThatTriggersRepublish(publishSettings)
	return {
		default = false,
		rating = true,
		label = true,
		keywords = true,
		title = true,
		caption = true,
		dateCreated = true,
	}
end

-- Deleting photos from the catalog never removes anything from AutoPost.
function provider.shouldDeletePhotosFromServiceOnDeleteFromCatalog(publishSettings, nPhotos)
	return 'ignore'
end

-- Removing photos from a published collection only marks them as unlinked in AutoPost.
function provider.deletePhotosFromPublishedCollection(publishSettings, arrayOfPhotoIds, deletedCallback)
	AutoPostApi.unlinkPhotos(publishSettings, arrayOfPhotoIds)
	for _, photoId in ipairs(arrayOfPhotoIds) do deletedCallback(photoId) end
end

function provider.renamePublishedCollection(publishSettings, info)
	if info.publishedCollection then
		AutoPostApi.updateCollection(publishSettings, info.publishedCollection.localIdentifier, info.name, 'rename')
	end
end

function provider.deletePublishedCollection(publishSettings, info)
	if info.publishedCollection then
		AutoPostApi.updateCollection(publishSettings, info.publishedCollection.localIdentifier, info.name or 'AutoPost', 'unlink')
	end
end

local function metadataFor(photo, collection, rendition, filePath)
	local label = photo:getRawMetadata('colorNameForLabel')
	if label == 'none' or label == '' then label = nil end
	return AutoPostApi.object(
		{ 'lrCollectionId', 'lrCollectionName', 'lrPhotoUuid', 'assetId', 'filename', 'rating', 'label', 'pick', 'keywords', 'dateTimeOriginal' },
		{
			lrCollectionId = tostring(collection.localIdentifier),
			lrCollectionName = collection:getName(),
			lrPhotoUuid = photo:getRawMetadata('uuid'),
			assetId = rendition.publishedPhotoId,
			filename = LrPathUtils.leafName(filePath),
			rating = photo:getRawMetadata('rating'),
			label = label,
			pick = photo:getRawMetadata('pickStatus') or 0,
			keywords = AutoPostApi.splitKeywords(photo:getFormattedMetadata('keywordTagsForExport')),
			dateTimeOriginal = photo:getRawMetadata('dateTimeOriginal'),
		}
	)
end

function provider.processRenderedPhotos(functionContext, exportContext)
	local exportSession = exportContext.exportSession
	local settings = exportContext.propertyTable
	local collection = exportContext.publishedCollection
	local total = exportSession:countRenditions()
	local progress = exportContext:configureProgress {
		title = total > 1 and string.format('Publishing %d photos to AutoPost', total) or 'Publishing one photo to AutoPost',
	}
	if not collection then
		error('AutoPost only supports publishing through a published collection.')
	end
	local okPing, pingMessage = LrTasks.pcall(AutoPostApi.ping, settings)
	if not okPing then
		LrDialogs.message('AutoPost', tostring(pingMessage), 'critical')
		return
	end
	for _, rendition in exportContext:renditions { stopIfCanceled = true } do
		local success, pathOrMessage = rendition:waitForRender()
		if progress:isCanceled() then break end
		if success then
			local ok, result = LrTasks.pcall(function()
				return AutoPostApi.publishPhoto(settings, pathOrMessage, metadataFor(rendition.photo, collection, rendition, pathOrMessage))
			end)
			if ok then
				rendition:recordPublishedPhotoId(result)
			else
				logger:warn('Upload failed: ' .. tostring(result))
				rendition:uploadFailed(tostring(result))
			end
		else
			rendition:uploadFailed(tostring(pathOrMessage))
		end
	end
	progress:done()
end

return provider
