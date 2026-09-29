--[[ AutoPost for Lightroom Classic

Read-only by design: this plug-in only reads photo metadata and sends rendered
JPEG copies to the local AutoPost app. It never writes to the catalog or to the
file system. scripts/check-lightroom-plugin.sh enforces this rule.
]]

return {
	LrSdkVersion = 10.0,
	LrSdkMinimumVersion = 10.0,

	LrToolkitIdentifier = 'dev.autopost.lightroom',
	LrPluginName = 'AutoPost',
	LrPluginInfoUrl = 'http://127.0.0.1:3000',

	LrLibraryMenuItems = {
		{ title = 'AutoPost: Log selected ratings', file = 'LogRatings.lua' },
	},

	LrExportServiceProvider = {
		title = 'AutoPost',
		file = 'AutoPostServiceProvider.lua',
	},

	VERSION = { major = 0, minor = 1, revision = 0 },
}
