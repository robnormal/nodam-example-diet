var
	_      = require('../nodam/lib/curry.js'),
	orm    = require('./lib/orm.js'),
	nodam  = require('../nodam/lib/nodam.js'),
	sql    = require('../nodam/lib/sqlite.js'),
	M      = nodam.Maybe;

var fmap = _.flip(_.map);

var dbM = nodam.get('db')
	.pipe(function(db) {
		if (db) {
			return nodam.result(db);
		} else {
			return sql.database('diet.db').pipe(function(db_open) {
				return nodam.set('db', db_open);
			});
		}
	});

var queries = {
	foods:
		'SELECT * FROM foods',
	foods_insert:
		'INSERT INTO foods (name, type, cals, grams) ' +
		"VALUES ('<%= name %>', '<%= type %>', '<%= cals %>', '<%= grams %>')",
	foods_update:
		'UPDATE foods ' +
		"SET name='<%= name %>', type='<%= type %>', cals='<%= cals %>', grams='<%= grams %>' " +
		'WHERE id=<%= id %>',
	ingredients:
		'SELECT * from ingredients',
	ingredients_insert:
		'INSERT INTO ingredients (food_id, ingredient_id, grams) VALUES ' +
		'(<%= food_id %>, <%= ingred_id %>, <%= grams %>)',
	ingredients_update:
		'UPDATE ingredients SET grams=<%= grams %> ' +
		'WHERE food_id=<%= food_id %> AND ingredient_id=<%= update %>',
	ingredients_with_foods:
		'SELECT i.food_id, i.ingredient_id, i.grams, ' +
		'f.id, f.name, f.type, f.cals, f.grams AS food_grams FROM ingredients i ' +
		'JOIN foods f ON i.ingredient_id=f.id',
	meals:
		'SELECT * FROM meals',
	meals_insert:
		"INSERT INTO meals (created_at) VALUES (datetime('now'))",
	meal_foods_with_foods:
		'SELECT mf.meal_id, mf.food_id, mf.grams, ' +
		'f.id, f.name, f.type, f.cals, f.grams AS food_grams FROM meal_foods mf ' +
		'JOIN foods f ON mf.food_id=f.id',
	meal_foods_update:
		'UPDATE meal_foods SET grams=<%= grams %> ' +
		'WHERE meal_id=<%= meal_id %> AND food_id=<%= food_id %>',
	meal_foods_insert:
		'INSERT INTO meal_foods (meal_id, food_id, grams) ' +
		'VALUES (<%= meal_id %>, <%= food_id %>, <%= grams %>)',
	food_update_cals:
		'UPDATE foods JOIN ingredients i ON foods.id=i.food_id ' +
		'JOIN foods fi On i.food_id=fi.id ' +
		"SET foods.cals=SUM(fi.cals) WHERE i.food_id=foods.id AND fi.id=i.food_id " +
		"AND foods.type='dish' AND foods.id=<%= id %>"
};

function getFood(db, id) {
	return db.get(queries.foods + orm.condition({id: id}));
}

function foodByName(name) {
	var query = queries.foods + orm.condition({name: name});

	return dbM.pipe(function(db) {
		db.get(query);
	});
}

function getMeal(db, id) {
	return db.get(queries.meals + orm.condition({id: id}));
}

function hydrateIngredient(row) {
	return {
		food_id: row.food_id,
		ingredient_id: row.ingredient_id,
		grams: row.grams,
		food: {
			id: row.id,
			name: row.name,
			type: row.type,
			cals: row.cals,
			grams: row.food_grams
		}
	};
}

function hydrateMealFood(row) {
	return {
		meal_id: row.meal_id,
		food_id: row.food_id,
		grams: row.grams,
		food: {
			id: row.id,
			name: row.name,
			type: row.type,
			cals: row.cals,
			grams: row.food_grams
		}
	};
}

function requireString(str, err) {
	if (! str) throw new Error(err || 'empty string');
}

function requireQuery(template, data) {
	var q = _.template(template, data);
	requireString(q, 'bad query template: ' + template);

	return q;
}

function fillIngredients(food) {
	if (food.type !== 'dish' || food.ingredients) {
		return nodam.result(food);
	} else {
		return dbM.pipe(function(db) {
			return db
				.all(queries.ingredients_with_foods +
					orm.condition({ 'i.food_id': food.id }))
				.pipe(function (ings) {
					return nodam.result(_.set(food, 'ingredients', ings));
				});
		});
	}
}

function updateFoodCals(food) {
	if (food.type === 'dish') {
		return dbM .pipe(function(db) {
			return fillIngredients(food)
				.pipe(function(ings) {
					return nodam.result(
						_.reduce(ings, function(ing, memo) {
							return ing.cals * ing.grams;
						}, 0) / food.grams
					)})
				.then(db.get(
					'SELECT cals FROM foods' + orm.condition({ id: food.id })
				));
		}) .pipe(function(row) {
			return nodam.result(_.set(food, 'cals', row.cals));
		});
	} else {
		return nodam.result(food);
	}
}

function ingredientsForFoodM(food) {
	var q = queries.ingredients_with_foods +
		orm.condition({ food_id: food.id }) + ' ORDER BY i.grams DESC';

	return dbM .pipe(_.method('all', [q]));
}

function ingredientsM(db, food) {
	if (food.type === 'ingredient') {
		return nodam.result(food);
	} else {
		return db.all(
			queries.ingredients_with_foods + orm.condition({ food_id: food.id })
		) .mmap(
			_.curry(fmap, hydrateIngredient)
		) .pipe(function (ingredients) {
			var $food = _.set(food, 'ingredients', ingredients);

			if (food.grams) {
				$food.cals = ingredients.reduce(function(sum, i) {
					return sum + i.food.cals * i.grams;
				}, 0) / food.grams;
			}

			return nodam.result($food);
		});
	}
}

function allFoodsM(db) {
	return db
		.all(queries.foods)
		.pipe(function(foods) {
			return nodam.sequence(
				_.fmap(_.curry(ingredientsM, db), foods)
				);
		});
}

module.exports = {
	dbM:                 dbM,
	queries:             queries,
	getFood:             getFood,
	foodByName:          foodByName,
	getMeal:             getMeal,
	hydrateIngredient:   hydrateIngredient,
	hydrateMealFood:     hydrateMealFood,
	fillIngredients:     fillIngredients,
	updateFoodCals:      updateFoodCals,
	ingredientsForFoodM: ingredientsForFoodM,
	ingredientsM:        ingredientsM,
	allFoodsM:           allFoodsM
};
