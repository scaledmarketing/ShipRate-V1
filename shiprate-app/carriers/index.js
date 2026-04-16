/**
 * Carrier registry — add new carriers here
 */

const aramex = require('./aramex');

const carriers = {
  aramex: aramex,
  // Future carriers:
  // auspost: require('./auspost'),
  // tnt: require('./tnt'),
  // dhl: require('./dhl'),
};

module.exports = carriers;
