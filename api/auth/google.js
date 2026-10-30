'use strict';
const { handleGoogleAuth } = require('../../lib/google-auth');
module.exports = async function googleAuthEndpoint(req, res) {
  return handleGoogleAuth(req, res);
};
