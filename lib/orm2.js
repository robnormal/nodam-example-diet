var
  _      = require('../../nodam/lib/curry.js'),
  nodam  = require('../../nodam/lib/nodam.js'),
  sql    = require('../../nodam/lib/sqlite.js'),
	R      = require('../../nodam/lib/restriction.js'),
  M      = nodam.Maybe,
	Async  = nodam.Async,
	util = require('util');

var __slice = [].slice;
var fmap = _.flip(_.map);

function toInt(x) { return parseInt(x, 10) }

function DBEmptyFailure(query, params) {
  this.err = { query: query, params: params };
}
util.inherits(DBEmptyFailure, nodam.AsyncFailure);

function DBMissingFailure(table, condition) {
  this.err = { table: table, condition: condition };
}
util.inherits(DBMissingFailure, DBEmptyFailure);

function errMissing(table, condition) {
	return new DBMissingFailure(table, condition);
}

function getDB(file) {
	return nodam.get('db')
		.pipe(function(db) {
			if (db) {
				return Async.result(db);
			} else {
				return sql.database(file).pipe(function(db_open) {
					return nodam.set('db', db_open);
				});
			}
		});
}


var allTables = ['foods', 'ingredients', 'meals', 'meal_foods', 'plans', 'plan_meals', 'weeks', 'week_plans'];

function copyDB(fromFile, toDB) {
	return toDB
		.run("ATTACH '" + fromFile + "' as fromDB")
		.then(Async.mapM(allTables, function( table ) {
			var q = 'CREATE TABLE ' + table + ' AS SELECT * FROM fromDB.' + table;
			return toDB.run(q);
		}));
}

function getCachedDB(file) {
	return nodam.get('db')
		.pipe(function(db) {
			if (db) {
				return Async.result(db);
			} else {
				return sql.database(':memory:').pipe(function(memDB) {
					return copyDB(file, memDB)
						.set('db', memDB);
					});
			}
		});
}

// The master database monad object
// var dbM = getDB(':memory:');

var dbM = getCachedDB('diet.db');

// utilities
function requireString(str, err) {
	if (! str) throw new Error(err || 'empty string');
}

function requireQuery(tmpl, data) {
	R.manualCheck(tmpl && (typeof tmpl === 'string'), 'Expected string template');

	var q = _.template(tmpl, data);
	requireString(q, 'bad query template: ' + tmpl);

	return q;
}


// make code a little cleaner
function dbFunction(name) {
	return function() {
		var args = arguments;
		return dbM.pipe(function(db_obj) {
			return db_obj[name].apply(db_obj, args);
		});
	};
}

function dbQueryFunction(name) {
	return function(query /* , args... */) {
		R.manualCheck(query && (typeof query === 'string'), 'Expected SQL query');

		var args = __slice.call(arguments, 1);
		return dbM.pipe(function(db_obj) {
			return db_obj[name].apply(db_obj, [query].concat(args));
		});
	};
}

function dbTemplateFunction(name) {
	return function(tmpl, data /*, args.. */) {
		var q = requireQuery(tmpl, data);

		var args = __slice.call(arguments, 2);
		return dbM.pipe(function(db_obj) {
			return db_obj[name].apply(db_obj, [q].concat(args));
		});
	};
}

var runQuery = dbTemplateFunction('run');

var
	dbGet = dbQueryFunction('get'),
	dbAll = dbQueryFunction('all'),
	dbRun = dbQueryFunction('run'),
	dbReduce = dbQueryFunction('reduce'),

	dbGetQ = dbTemplateFunction('get'),
	dbAllQ = dbTemplateFunction('all'),
	dbRunQ = dbTemplateFunction('run'),
	dbReduceQ = dbTemplateFunction('reduce'),

	dbClose = dbFunction('close'),
	dbGetOrFail = function(q, params) {
		return dbGet(q, params).pipeMaybe(
			new DBEmptyFailure(q, params),
			Async.result
		);
	};

function queryValue(x) {
	return x.toQueryValue ?
		x.toQueryValue() :
		"'" + x + "'";
}

function Literal(str) {
	this.str = str;
}
Literal.prototype.toQueryValue = function() {
  return this.str;
};

function literal(str) {
	return new Literal(str);
}

function Like(s) { this.str = s }

function like(str) {
	return new Like(str);
}

function queryCondition(key, val) {
	if (val instanceof Like) {
		return key + " LIKE '" + val.str + "'";
	} else {
		return key + "=" + queryValue(val);
	}
}

function condition(obj) {
	var conds = [];
	_.forOwn(obj, function(val, key) {
		if (val === undefined) {
			throw new Error('no value for key "' + key + '"');
		}

		conds.push(queryCondition(key, val));
	});

	if (conds.length) {
		return ' WHERE ' + conds.join(' AND ');
	} else {
		return '';
	}
}

function querySet(obj) {
	_.map(obj, function(val, key) {
		return key + '=' + queryValue(val);
	});
}



var
	INT = 'int',
	FLOAT = 'float',
	STRING = 'string',
	ARRAY = 'array',
	ONE = 'one',
	MANY = 'many';

// null marks empty values
function fromDB(type, data) {
	if (typeof data === 'undefined') return data;
	if (data === '' && type !== STRING) return null;

	switch(type) {
	case INT:
		return toInt(data);
	case FLOAT:
		return parseFloat(data);
	case STRING:
		return data;
	case ARRAY:
		return data;
	default:
		if (type instanceof Function) {
			R.manualCheck(data instanceof type, 'Expected type: ' + type);

			return data;
		} else {
			throw new R.CheckError('No such type: ' + type);
		}
	}
}

function Record() {}

_.extend(Record.prototype, {

	_populate: function(args) {
		var fields = this.constructor.fields;

		for (var i = 0, len = fields.length; i < len; i++) {
			this[fields[i]] = args[i];
		}
	},

	set: function(key, val) {
		return _.set(this, key, val);
	}
});

function underscorize(str) {
	return str.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase();
}

// putting this out here to avoid creating it every time camelize is called
var camelizePart = function (part) {
	return part[1].toUpperCase();
};

function camelize(str) {
	return str.replace(/_\w/g, camelizePart)
}

function RecordJoin(varName, klass, type) {
	this.varName = varName;
	this.klass = klass;
	this.type = type;
}

function recordize$(f, table, table_info) {
	util.inherits(f, Record);

	f.table = table;
	f.args = [];
	f.fields = [];
	f.joinNames = [];
	f.types = {}; // data about DB columns
	f.joins = {};

	_.each(table_info.fields, function(column) {
		f.fields.push(column[0]);

		f.types[column[0]] = {
			type: column[1]
		};
	});

	var info_joined = table_info.joined || [];

	_.each(info_joined, function(join) {
		f.joinNames.push(join[0]);

		f.joins[join[0]] = new RecordJoin(join[0], join[1], join[2]);
	});

	var all_info = table_info.fields.concat(info_joined);

	_.each(all_info, function(info) {
		// add arguments to constructor
		f.args.push(info[0]);

		// create setters for records
		f.prototype[camelize('set_' + info[0])] = function(val) {
			return this.set(info[0], val);
		};
	});

	_.extend(f, {
		hydrate: function(obj, options) {
			options = options || {};

			var record = new f();
			var prefix = options.prefix || '';

			_.each(f.fields, function(field) {
				record[field] = fromDB(
					f.types[field].type,
					obj[prefix + field]
				);
			});

			return record;
		},

		fieldList: function(alias_prefix, table_alias) {
			var tname = table_alias ? table_alias : f.table;

			return _.map(f.fields, function(field) {
				return tname + '.' + field +
					(alias_prefix ? ' AS `' + alias_prefix + field + '`' : '');
			}).join();
		},

		_query: function(conds, options) {
			options = options || {};

			var q = 'SELECT ' + f.fieldList() + ' FROM ' + f.table + condition(conds);
			if (options.order_by) {
				q += ' ORDER BY ' + options.order_by;
			}

			return q;
		},

		find: function(conds, options) {
			var q = f._query(conds, options);

			return f.select(q, options);
		},

		get: function(conds, options) {
			var q = f._query(conds, options);

			return f.selectOne(q, options);
		},

		select: function(query, options) {
			return dbAll(query).mmapFmap(f.hydrate);
		},

		selectOne: function(query, options) {
			return dbGet(query).mmapFmap(f.hydrate);
		}
	});
}

function Food() { this._populate(arguments); }
recordize$(Food, 'foods', {
	fields: [
		['id', INT],
		['name', STRING],
		['type', STRING],
		['cals', FLOAT],
		['grams', INT]
	],
	joined: [
		['ingredients', Food, MANY]
	]
});

function Ingredient() { this._populate(arguments); }
recordize$(Ingredient, 'ingredients', {
	fields: [
		['food_id', INT],
		['ingredient_id', INT],
		['grams', INT]
	],
	joined: [
		['food', Food, ONE],
		['ingredient', Food, ONE],
	]
});

function Meal() { this._populate(arguments); }
recordize$(Meal, 'meals', {
	fields: [
		['id', INT],
		['name', STRING],
		['created_at', STRING]
	],
	joined: [
		['foods', Food, MANY]
	]
});

function MealFood() { this._populate(arguments); }
recordize$(MealFood, 'meal_foods', {
	fields: [
		['meal_id', INT],
		['food_id', INT],
		['grams', INT]
	],
	joined: [
		['meal', Meal, ONE],
		['food', Food, ONE]
	]
});

MealFood.prototype.getFood = function() {
	return Food.get({ id: this.food_id });
};

function Plan() { this._populate(arguments); }
recordize$(Plan, 'plans', {
	fields: [
		['id', INT],
		['name', STRING]
	],
	joined: [
		['meals', Meal, MANY]
	]
});

function PlanMeal() { this._populate(arguments); }
recordize$(PlanMeal, 'plan_meals', {
	fields: [
		['id', INT],
		['plan_id', INT],
		['meal_id', INT],
		['ordinal', INT]
	],
	joined: [
		['plan', Plan, ONE],
		['meal', Meal, ONE]
	]
});

function Week() { this._populate(arguments); }
recordize$(Week, 'weeks', {
	fields: [
		['id', INT],
		['name', STRING]
	],
	joined: [
		['plans', Plan, MANY]
	]
});

function WeekPlan() { this._populate(arguments); }
recordize$(WeekPlan, 'week_plans', {
	fields: [
		['id', INT],
		['week_id', INT],
		['plan_id', INT],
		['ordinal', INT]
	],
	joined: [
		['week', Week, ONE],
		['plan', Plan, ONE]
	]
});

var FoodNutrient;
function Nutrient() { this._populate(arguments); }
recordize$(Nutrient, 'nutrients', {
	fields: [
		['id', INT],
		['name', STRING]
	],
	joined: [
		['food_nutrients', FoodNutrient, MANY]
	]
});

function FoodNutrient() { this._populate(arguments); }
recordize$(FoodNutrient, 'food_nutrients', {
	fields: [
		['food_id', INT],
		['nutrient_id', INT],
		['amount', FLOAT]
	],
	joined: [
		['food', Food, ONE],
		['nutrient', Nutrient, ONE],
	]
});

var allFoods = Food.select(Food._query({}, { order_by: 'name'}));
/*
	.pipe(function(foods) {
		return Async.sequence(
			_.fmap(ingredientsForFood, foods)
		)
	});
	*/


// ammounts = [ { food_id: { food: food, grams: number }, ...},  ...]
function addAmounts(amounts) {
	var totals = {};

	_.each(amounts, function(amount) {
		_.each(amount, function(part, food_id) {
			if (totals[food_id]) {
				totals[food_id].grams += part.grams;
			} else {
				totals[food_id] = part;
			}
		});
	});

	return totals;
}


function fillJoined(record, varName, conds)
{
	var join = record.constructor.joins[varName];
	if (!join) throw new Error();

	return join.klass.find(conds).mmap(function(j_records) {
		return record.set(varName, j_records);
	});
}

var allMeals = Meal.find({}, { order_by: 'created_at DESC' });

/* Food -> Async( Food ) */
function fillIngredients(food) {
	return Ingredient.find({ food_id: food.id }).mmap(function( ings ) {
		var ings2 = _.map(ings, function(ing) { return ing.setFood(food) });

		return food.setIngredients(ings2);
	});
}

// this is awkward
// need to redo conditions to be a list, not an object,
// since conditions are not unique wrt columns
function foodsWithIngredients(conds, options) {
	return Food.find(conds, options).pipeMapM(function(x) {
		return fillIngredients(x);
	});
}

function getPlanMeals(plan) {
	return PlanMeal.find({ plan_id: plan.id }, {order_by: 'ordinal'})
		.pipeMapM(function (p_meal) {
			return Meal.get({ id: p_meal.meal_id })
				.mmapFmap(function( meal ) {
					return p_meal.setMeal(meal);
				});
		}).mmap(M.Maybe.concat);
}

/* MealFood -> MealFood */
function setMealFoodCals(m_food) {
  var cals = m_food.grams * m_food.food.cals / 100;
  return m_food.set('cals', cals);
}

/**
 * Meal -> Async( [MealFood] )
 */
function mealFoodsWithFoods(meal) {
	return MealFood.find({ meal_id: meal.id})
		.pipeMapM(function( m_food ) {
			return m_food.getFood().pipe(function( mb_food ) {
				if (mb_food.isJust()) {
					return fillIngredients(mb_food.fromJust()).pipe(function( food ) {
						var m_food2 = m_food.setFood(food);
						var m_food3 = setMealFoodCals(m_food2);

						return nodam.result(M.just(m_food3));
					});
				} else {
					return nodam.result(M.nothing);
				}
			});
	}).mmap(M.Maybe.concat);
}

/* conds -> options -> Async( Ingredient ) */
function ingredientsWithFoods(conds, options) {
	return Ingredient.find(conds)
		.pipeMapM(function( ingred ) {
			return Food.get({ id: ingred.ingredient_id })
				.mmapFmap(function(food) {
					return ingred.setIngredient(food);
				});
	}).mmap(M.Maybe.concat);
}

/* MealFood -> Async( [amount]) */
function getAmountsFromIngredients(m_food) {
	return Food.get({ id: m_food.food_id }).pipeMaybe(
		nodam.failure('no food with that ID'),
		function( food ) {
			return ingredientsWithFoods({ food_id: m_food.food_id })
				.mmap(function( ingreds ) {
					var total_grams = _.reduce(ingreds, function(memo, ing) {
						return memo + ing.grams;
					}, 0);

					var amount = {};
					_.each(ingreds, function(ingred) {
						amount[ingred.ingredient_id] = {
							food: ingred.ingredient,
							grams: m_food.grams * ingred.grams / food.grams
						};
					});

					return amount;
				});
		});
}

/* MealFood -> Async ( [amount] ) */
function amountsInMealFood(m_food) {
	var food = m_food.food;
	var amount = {};

	if (food.type === 'ingredient') {
		amount[food.id] = { food: food, grams: m_food.grams };

		return Async.result([amount]);
	} else {
		return getAmountsFromIngredients(m_food);
	}
}


/* Meal -> Async( [amount] ) */
function mealIngredients(meal) {
	return mealFoodsWithFoods(meal).pipe(function( m_foods ) {
		return Async.mapM(m_foods, amountsInMealFood).mmap(addAmounts);
	});
}

/* Plan -> Async( [amount] ) */
function planIngredients(plan) {
	return getPlanMeals(plan)
		.pipeMapM(function(p_meal) {
			return mealIngredients(p_meal.meal);
		})
		.mmap(addAmounts);
}

function setMealCals(meal) {
	var cals = _.reduce(meal.meal_foods, function(memo, m_food) {
		return memo + m_food.cals;
	}, 0);

	// if m_food.cals is null, return null here
	cals = cals || cals === 0 ? cals : null;

	return meal.set('cals', cals);
}


function getFoodsInMeal(meal) {
	return MealFood.find({ meal_id: meal.id })
		.pipeMapM(function(m_food) {
			return Food.get({ id: m_food.food_id })
				.mmapFmap(function(food) {
					return m_food.setFood(food).setMeal(meal);
				});
		})
		.mmap(M.Maybe.concat);
}

function fillMealFoods(meal) {
	R.manualCheck(meal instanceof Meal);

	return mealFoodsWithFoods(meal).pipe(function (m_foods) {
		var meal2 = meal.set('meal_foods', m_foods);

		// now get the meal calories
		return Async.result(setMealCals(meal2));
	});
}

function sumCals(objs) {
	return _.reduce(objs, function(memo, obj) {
		return memo + obj.cals;
	}, 0);
}

function planMealsWithFoods(plan) {
	return getPlanMeals(plan).pipeMapM(function( p_meal ) {
		return fillMealFoods(p_meal.meal).mmap(function( meal ) {
			return p_meal.setMeal(meal);
		});
	});
}

function planWithFoods(plan) {
  return planMealsWithFoods(plan).mmap(function( plan_meals ) {
    return plan.set('plan_meals', plan_meals);
	});
}

function deleteNutrient(id) {
  return dbRun('DELETE FROM nutrients ' + condition({ id: id }))
		.then(dbRun('DELETE FROM food_nutrients ' + condition({ nutrient_id: id })));
}

function createNutrient(name) {
  return dbRun("INSERT INTO nutrients (name) VALUES ('" + name + "')");
}

function foodNutrient(nutrient, food) {
	return FoodNutrient.get({
		food_id: food.id,
		nutrient_id: nutrient.id
	}).pipeMaybe(
		nodam.result(0),
		function( f_nut ) {
			return nodam.result(f_nut.amount)
		}
	);
}

function foodNutrients(food) {
	return FoodNutrient.find({ food_id: food.id }).pipeMapM(function( f_nut ) {
		return Nutrient.get({ id: f_nut.nutrient_id }).mmapFmap(function( nut ) {
			return f_nut.setNutrient(nut);
		});
	}).mmap(M.Maybe.concat);
}

function createFoodNutrient(food, nut_name, amount) {
	return Nutrient.get({ name: nut_name }).pipeMaybe(
		nodam.failure('No nutrient called ' + nut_name),
		function( nut ) {
			return dbRun('INSERT INTO food_nutrients (food_id, nutrient_id, amount) VALUES(' +
				food.id + ',' + nut.id + ',' + amount + ')'
			);
		}
	);
}

function deleteFoodNutrient(food, nutrient_id) {
  return dbRun('DELETE FROM food_nutrients ' + condition({
    food_id: food.id,
    nutrient_id: nutrient_id
	}))
}

function allNutrientsIn(ing_amounts_m) {
	return Nutrient.find().pipe(function( nutrients ){
		// create map { id => nutrient }
		var nuts_map = {}, i = 0, len = nutrients.length;
		for (; i < len; i++) {
			nuts_map[nutrients[i].id] = nutrients[i];
		}

		return ing_amounts_m.pipeMapM(function( ing_amount ) {
			return FoodNutrient.find({
				food_id: ing_amount.food.id
			}).mmap(function( f_nuts ){

				// create map nut_id => f_nut
				var f_nuts_map = {}, i = 0, len = f_nuts.length;
				for (; i < len; i++) {
					f_nuts_map[f_nuts[i].nutrient_id] = f_nuts[i];
				}

				return _.reduce(nuts_map, function(memo, nut, id) {
					if (f_nuts_map[id]) {
						memo[id] = ing_amount.grams *
							f_nuts_map[id].amount;
					} else {
						memo[id] = 0;
					}

					return memo;
				}, {});

			});
		}).mmap(function( nutrient_to_amts ) {
			var amts = {};

			_.each(nutrient_to_amts, function(nut_to_amt) {
				_.each(nut_to_amt, function(amt, id) {
					amts[id] = amts[id] || { nutrient: nuts_map[id], amount: 0 };
					amts[id].amount += amt / 100;
				});
			});

			return amts;
		});
	});
}

function nutrientIn(nutrient, ing_amounts_m) {
	return ing_amounts_m.pipeMapM(function( ing_amount ) {
		return FoodNutrient.get({
			food_id: ing_amount.food.id,
			nutrient_id: nutrient.id
		}).mmap(function( m_f_nut ) {
			return m_f_nut.isJust() ?
				m_f_nut.fromJust().amount * ing_amount.grams :
				0;
		});
	}).mmap(function(xs) {
		var sum = _.reduce(xs, function(memo, x) { return memo + x; }, 0);

		return sum / 100;
	});
}

/* Plan -> Async( [FoodNutrient] ) */
function planNutrientAmount(plan, nutrient) {
	return nutrientIn(nutrient, planIngredients(plan));
}

/* Meal -> Async( [FoodNutrient] ) */
function mealNutrientAmount(meal, nutrient) {
	return nutrientIn(nutrient, mealIngredients(meal));
}


var nutrientQuery = 'SELECT ' + Nutrient.fieldList('n_', 'n') + ', ' +
	FoodNutrient.fieldList('fn_', 'fn') + ', ' +
	Food.fieldList('f_', 'f') + ' ' +
	'FROM nutrients n ' +
	'LEFT JOIN food_nutrients fn ON fn_nutrient_id = n_id ' +
	'LEFT JOIN foods f ON f_id=fn_food_id <%= condition %> ORDER BY fn_amount DESC'

/* condition -> Async(Maybe( Nutrient )) */
function nutrientWithFoods(cond) {
	return dbAllQ(nutrientQuery, { condition: condition(cond) })
		.mmap(function( rows ) {
			if (0 === rows.length) {
				return M.nothing;
			} else {
				var
					f_nuts = _.map(rows, function(row) {
						var
							food = Food.hydrate({
								id: row.fn_food_id,
								name: row.f_name,
								type: row.f_type,
								cals: row.f_cals,
								grams: row.f_grams
							}),
							n_food = FoodNutrient.hydrate({
								food_id: row.fn_food_id,
								nutrient_id: row.n_id,
								amount: row.fn_amount
							});

						// if no id for food, then there's no food there
						return food.id ?
							M.just(n_food.setFood(food)) :
							M.nothing;
					}),
					nutrient = Nutrient.hydrate({
						id: rows[0].n_id,
						name: rows[0].n_name
					}).setFoodNutrients(M.Maybe.concat(f_nuts));

				return M.just(nutrient);
			}
		});
}


var nutPerNutQuery = 'SELECT fn1.amount / fn2.amount ' +
	'FROM food_nutrients fn1, food_nutrients fn2 ' +
	'WHERE fn2.food_id = fn1.food_id ' +
	'AND fn1.food_id = <%= food_id %> ' +
	'AND fn1.nutrient_id = <%= nutrient1_id %> ' +
	'AND fn2.nutrient_id = <%= nutrient2_id %>';

/* Nutrient -> Nutrient -> Food -> Async(Maybe( Float )) */
function nutrientPerNutrient(nut1_id, nut2_id, food_id) {
	return dbGetQ(nutPerNutQuery, {
		food_id: food_id,
		nutrient1_id: nut1_id,
		nutrient2_id: nut2_id
	}).mmapFmap(function(row) { return row[0] });
}

var ratioRankQuery = 'SELECT foods.*, fn1.amount / fn2.amount AS ratio FROM foods ' +
	'JOIN food_nutrients fn1 ON fn1.food_id = foods.id ' +
	'AND fn1.nutrient_id = <%= nutrient1_id %> ' +
	'JOIN food_nutrients fn2 ON fn2.food_id = foods.id ' +
	'AND fn2.nutrient_id = <%= nutrient2_id %> ' +
	// 'ORDER BY fn1.amount / fn2.amount';
	'ORDER BY ratio DESC';

/* Nutrient -> Nutrient -> Food -> Async(Maybe( Float )) */
function ratioRank(nut1_id, nut2_id) {
	return dbAllQ(ratioRankQuery, {
		nutrient1_id: nut1_id,
		nutrient2_id: nut2_id
	}).mmapFmap(function( row ) {
		return { food: Food.hydrate(row), ratio: row.ratio };
	});
}


module.exports = {
	INT: INT,
	FLOAT: FLOAT,
	STRING: STRING,
	ARRAY: ARRAY,

	DBEmptyFailure: DBEmptyFailure,
	DBMissingFailure: DBMissingFailure,
	errMissing: errMissing,
	getDB: getDB,
	dbM: dbM,

	runQuery:    runQuery,
	get:       dbGet,
	all:       dbAll,
	run:       dbRun,
	reduce:    dbReduce,
	getQ:      dbGetQ,
	allQ:      dbAllQ,
	runQ:      dbRunQ,
	reduceQ:   dbReduceQ,
	close:     dbClose,
	getOrFail: dbGetOrFail,


	toInt:      toInt,
	queryValue: queryValue,
	Literal:    Literal,
	literal:    literal,
	condition:  condition,
	querySet:   querySet,
	fromDB:     fromDB,
	like: like,

	Record: Record,
	recordize$: recordize$,

	Food:       Food,
	Ingredient: Ingredient,
	Meal:       Meal,
	MealFood:   MealFood,
	Plan:       Plan,
	PlanMeal:   PlanMeal,
	Week:       Week,
	WeekPlan:   WeekPlan,
	Nutrient: Nutrient,
	FoodNutrient: FoodNutrient,

	allFoods: allFoods,
	allMeals: allMeals,
	foodsWithIngredients: foodsWithIngredients,
	getPlanMeals: getPlanMeals,
	fillMealFoods:      fillMealFoods,
	planWithFoods: planWithFoods,
	mealIngredients:    mealIngredients,
	planIngredients: planIngredients,
	createNutrient: createNutrient,
	deleteNutrient: deleteNutrient,
	foodNutrient: foodNutrient,
	foodNutrients: foodNutrients,
	createFoodNutrient: createFoodNutrient,

	mealNutrientAmount: mealNutrientAmount,
	planNutrientAmount: planNutrientAmount,
	allNutrientsIn: allNutrientsIn,
	deleteFoodNutrient: deleteFoodNutrient,
	nutrientWithFoods: nutrientWithFoods,
	nutrientPerNutrient: nutrientPerNutrient,
	ratioRank: ratioRank
}

