const { expo } = require('./app.json');

module.exports = {
  ...expo,
  android: {
    ...expo.android,
    // EAS file variables resolve to a temporary path on the remote builder.
    // Local native builds continue to use the ignored developer-owned file.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
};
