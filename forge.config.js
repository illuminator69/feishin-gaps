/* eslint-disable @typescript-eslint/no-require-imports -- electron-forge loads this as CommonJS */
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
    makers: [
        {
            config: {},
            name: '@electron-forge/maker-squirrel',
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin'],
        },
        {
            config: {},
            name: '@electron-forge/maker-deb',
        },
        {
            config: {},
            name: '@electron-forge/maker-rpm',
        },
    ],
    packagerConfig: {
        asar: true,
    },
    plugins: [
        {
            config: {},
            name: '@electron-forge/plugin-auto-unpack-natives',
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
            [FuseV1Options.RunAsNode]: false,
            version: FuseVersion.V1,
        }),
    ],
    rebuildConfig: {},
};
