'use strict';
const { handleSuppliersCatalog } = require('../lib/vercel-api');
module.exports = async function suppliersCatalogEndpoint(req, res) { return handleSuppliersCatalog(req, res); };
