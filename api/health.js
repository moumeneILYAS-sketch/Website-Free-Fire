'use strict';
const { handleHealth } = require('../lib/vercel-api');
module.exports = async function healthEndpoint(req, res) {
  return handleHealth(req, res);
};
