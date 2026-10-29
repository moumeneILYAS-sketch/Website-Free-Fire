'use strict';
const { handleOrder } = require('../lib/vercel-api');
module.exports = async function ordersEndpoint(req, res) {
  return handleOrder(req, res);
};
