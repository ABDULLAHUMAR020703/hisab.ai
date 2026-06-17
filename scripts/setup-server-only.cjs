const Module = require('module')
const original = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {}
  return original.apply(this, arguments)
}
