'use strict';
const { handleSupplierCatalog } = require('../lib/vercel-api');
module.exports = async function supplierCatalogEndpoint(req, res) {
  return handleSupplierCatalog(req, res);
};
