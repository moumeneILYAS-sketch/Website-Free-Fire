'use strict';
const { handleProducts } = require('../lib/vercel-api');
module.exports = async function productsEndpoint(req, res) {
  return handleProducts(req, res);
};
