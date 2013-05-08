var orm = require('../lib/orm.js');
var _ = require('nodam')._;

function doesntThrow(assert, f, err) {
	try {
		f();
	} catch (e) {
		assert.doesNotThrow(function () {
			throw e;
		}, err, e.toString());
	}
}

module.exports = {
	'Query handles repeated field names in a select statement': function(b, assert) {
		var
			q1 = new orm.Query({
				verb: orm.Query.SELECT,
				fields: ['id', 'name', 'id', 'address']
			}),
			sl1 = q1.selectList(),
			selects1 = sl1[0],
			returns1 = sl1[1],

			q2 = new orm.Query({
				verb: orm.Query.SELECT,
				fields: ['joe.id', 'joe.name', 'bob.id', 'address']
			}),
			sl2 = q2.selectList(),
			selects2 = sl2[0],
			returns2 = sl2[1];

		assert.equal(selects1, 'id,name,id AS id0,address', 'selectList returns string for SELECT query fields');
		assert.equal(_.uniq(returns1).length, returns1.length, 'selectList creates list of unique names');

		assert.equal(selects2, 'joe.id,joe.name,bob.id AS id0,address');
		assert.equal(_.uniq(returns2).length, returns2.length);
		assert.equal(returns2[1], 'name');
	}
};
