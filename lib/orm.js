var _ = require('../../nodam/lib/curry.js');
var M = require('../../nodam/lib/Maybe.js');

var
	SELECT = 'SELECT',
	INSERT = 'INSERT',
	UPDATE = 'UPDATE',
	DELETE = 'DELETE';

function Data(params) {
	return function() {
		var me = this, i;

		for (i = params.length - 1; i >= 0; --i) {
			me[params[i]] = arguments[i];
		}
	};
}

var Related = Data(['relation', 'retrieval']);
var Retrieval = Data(['table', 'indexRanges', 'relateds']);
var Relation = Data(['varName', 'table', 'type']);
Relation.HAS_ONE = 0;
Relation.HAS_MANY = 1;

var _rowObjProto = {
	add: function(rel, obj) {
		if (rel.type === Relation.HAS_MANY) {
			this[rel.varName] = this[rel.varName] || [];
			this[rel.varName].push(obj);
		} else {
			this[rel.varName] = obj;
		}
	}
};

function Table(config) {
	this.name = config.name;
	this.columns = config.columns;
	this.primary_key = config.primary_key;
	this.relMap = _.map(config.relations, function(relSpec) {
		return new Relation(relSpec[0], relSpec[1], relSpec[2]);
	});
	this.length = this.columns.length;

	var me = this;
	this.construct = function(params) {
		var i = 0, cols = this.table.columns, num_cols = this.table.length;

		for (i = 0; i < num_cols; i++) {
			this[cols[i]] = params[i];
		}

		// i is now equal to num_cols
		_.each(this.table.relMap, function(rel, j) {
			this.add(rel, params[i + j]);
		});
	}
	this.construct.prototype = _.clone(_rowObjProto);
	this.construct.prototype.table = me;
}

Table.prototype.columnsAliasedWithTable = function(prefix, table_alias) {
	var explicits, aliases, fieldsAs, i;

	for (var i = 0; i < this.length; i++) {
		explicits[i] = table_alias + '.' + this.columns[i];
		aliases[i] = prefix + '_' + this.columns[i];
		fieldsAs[i] = explicits[i] + ' AS ' + aliases[i];
	}

	return _.zip(explicits, aliases, fieldsAs);
};

Table.prototype.columnsAliased = function(prefix) {
	return this.columnsAliasedWithTable(prefix, this.name);
};

Table.prototype.hydrate = function(row, indices) {
	var data = [];

	_.each(indices, function(range) {
		data.concat(row.slice(range[0], range[1]));
	});

	var obj = this.construct(data);
};

Table.prototype.hydrateAssoc = function(obj) {
};

function retrieveOneRow(row, retrieval) {
	var main = retrieval.table.hydrate(row, retrieval.indexRanges);

	_.each(retrieval.relateds, function(related) {
		main.add(related.relation, retrieveOneRow(row, related.retrieval));
	});

	return main;
}

function populate(rows, retrieval) {
	var indices = retrieval.indexRanges;

	return _.map(rows, function(row) {
		return retrieveOneRow(row, retrieval);
	});
}

function Query(options) {
	this.verb = options.verb;
	this.fields = options.fields;
	this.width = this.fields.length;
}

Query.prototype.selectList = function() {
	if (! this._selectList) {
		var
			field_map = {},
			returned = [], // names of columns as they will be returned by sqlite
			str_parts = [], // will be joined to make query field list
			parts, col, suffix, alias;

		for (var i = 0; i < this.width; i++) {
			parts = this.fields[i].split('.'),
			// column is either what comes after '.', or if no dot, then the whole thing
			col = parts[1] || parts[0]

			if (undefined === field_map[col]) {
				field_map[col] = i; // side effect

				returned[i] = col;
				str_parts[i] = this.fields[i];
			} else {
				suffix = 0;

				do {
					alias = col + suffix;
					suffix++;
				}	while (undefined !== field_map[alias]);
				field_map[alias] = i; // side effect

				returned[i] = alias;
				str_parts[i] = this.fields[i] + ' AS ' + alias;
			}
		}

		this._selectList = [str_parts.join(), returned];
	}

	return this._selectList;
};

function queryValue(x) {
	return x.toQueryValue ?
		x.toQueryValue() :
		"'" + x + "'";
}

function Literal(str) {
	this.str = str;
}

function literal(str) {
	return new Literal(str);
}

function condition(obj) {
	var conds = [];
	_.forOwn(obj, function(val, key) {
		if (val === undefined) {
			throw new Error('no value for key "' + key + '"');
		}

		conds.push(key + "=" + queryValue(val));
	});

	if (conds.length) {
		return ' WHERE ' + conds.join(' AND ');
	} else {
		return '';
	}
}

function querySet(obj) {
	_.map(obj, function(val, key) {
		return key + '=' + orm.queryValue(val);
	});
}

module.exports = {
	Table: Table,
	Relation: Relation,
	Query: Query,
	SELECT: SELECT,
	INSERT: INSERT,
	UPDATE: UPDATE,
	DELETE: DELETE,
	condition: condition,
	literal: literal,
	queryValue: queryValue,
	querySet: querySet
};

/*
// undefined means "not retrieved"; null means retrieved but empty
// except for ingredients, where [] means retrieved but empty
var foods, ingredients, meals, meal_foods;

foods = new orm.Table({
	name: 'foods',
	columns: ['id', 'name', 'type', 'cals', 'grams'],
	primary_key: ['id'],
	relations: [
		['ingredients', ingredients, orm.Relation.HAS_MANY]
	]
});

ingredients = new orm.Table({
	name: 'ingredients',
	columns: ['food_id', 'ingredient_id', 'grams'],
	primary_key: ['food_id', 'ingredient_id'],
	relations: [
		['food', foods, orm.Relation.HAS_ONE],
		['ingredient', ingredients, orm.Relation.HAS_ONE]
	]
});

meals = new orm.Table({
	name: 'meals',
	columns: ['id', 'created_at'],
	primary_key: ['id'],
	relations: [
		['foods', foods, orm.Relation.HAS_MANY]
	]
});

meal_foods = orm.Table({
	name: 'meal_foods',
	columns: ['meal_id', 'food_id', 'grams'],
	primary_key: ['meal_id', 'food_id'],
	relations: [
		['meal', meals, orm.Relation.HAS_ONE],
		['food', foods, orm.Relation.HAS_ONE]
	]
});
*/

