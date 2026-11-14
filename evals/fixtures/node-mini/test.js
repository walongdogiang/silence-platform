const leftPad = require("left-pad");
const assert = require("assert");
assert.strictEqual(leftPad("7", 3, "0"), "007");
console.log("ok");
