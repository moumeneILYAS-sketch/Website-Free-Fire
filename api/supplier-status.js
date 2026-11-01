'use strict';
const { handleSupplierStatus } = require('../lib/vercel-api');
module.exports = async function supplierStatusEndpoint(req, res) {
  return handleSupplierStatus(req, res);
};
