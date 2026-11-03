'use strict';
const { handleSuppliersStatus } = require('../lib/vercel-api');
module.exports = async function suppliersStatusEndpoint(req, res) { return handleSuppliersStatus(req, res); };
