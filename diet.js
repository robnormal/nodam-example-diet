var
	_      = require('../nodam/lib/curry.js'),
	nodam  = require('../nodam/lib/nodam.js'),
	sqlite = require('../nodam/lib/sqlite.js'),
	qs     = require('querystring'),
	jade   = require('jade'),
	fs     = nodam.fs(),
	M      = nodam.Maybe;

var
	GET    = 'GET',
	POST   = 'POST',
	PUT    = 'PUT',
	DELETE = 'DELETE',
	error404, getPost, dbM;

function getJade(file, data) {
	return fs.readFile(file, 'ascii').pipe(function(view) {
		return nodam.result(jade.compile(view)(data));
	});
}

error404 = nodam.get('response').pipe(function(resp) {
	resp.status = 404;
	resp.write('Could not find requested URL');
	
	return nodam.result(resp.end());
});

function error403(msg) {
	nodam.get('response').pipe(function(resp) {
		resp.status = 404;
		resp.write(msg);
		
		return nodam.result(resp.end());
	});
}

getPost = nodam.get('request') .pipe(function(req) {
	if (req.method === POST) {
		var postData = '';
		var onM = nodam.methodToAsyncMonad('on');

		req.on('data', function (data) {
			if (postData.length < 1000) {
				postData += data;
			}
		});

		return onM(req, 'end').pipe(function () {
			// must call in here, after data has been constructed
			// ## DON'T change this to a then() ##
			return nodam.result(qs.parse(postData));
		});
	} else {
		return nodam.result([]);
	}
});

dbM = sqlite.database('diet.db').pipe(function(db) {
	return db.serialize().then(nodam.result(db));
});

function redirect(url) {
	return nodam.get('response').pipe(function(resp) {
		resp.statusCode = 302;
		resp.setHeader('Location', url);

		return nodam.result(resp.end());
	});
}

function display(resp, text) {
	resp.setHeader('Content-Type', 'text/html');
	resp.setHeader('Content-Length', text.length);
	resp.write(text);
	
	return resp;
}

function success(text) {
	return nodam.get('response').pipe(function(resp) {
		resp.statusCode = 200;

		return nodam.result(display(resp, text).end());
	});
}

function wordToUri(word) {
	return word.replace(/ /g, '+');
}

function uriToWord(word) {
	return word.replace(/\+/g, ' ');
}

function condition(obj) {
	var conds = [];
	_.forOwn(obj, function(val, key) {
		conds.push(key + "='" + val + "'");
	});

	if (conds.length) {
		return ' WHERE ' + conds.join();
	} else {
		return '';
	}
}

function matchUrl(regexOrString, url) {
	if (regexOrString instanceof RegExp) {
		return url.match(regexOrString);
	} else {
		return url === regexOrString ? [url] : null;
	}
}

function routeRequest(request, routes) {
	var
		url = decodeURIComponent(request.url),
		method = request.method,
		len = routes.length,
		match, action, i;

	for (i = 0; i < len; i++) {
		match = matchUrl(routes[i][0], url);

		if (match) {
			action = routes[i][1] && routes[i][1][method];

			if (action) {
				return M.just(action(match));
			}
		}
	}

	return M.nothing;
}

/*
// undefined means "not retrieved"; null means retrieved but empty
// except for ingredients, where [] means retrieved but empty
var foods, ingredients, meals, meal_foods;
var orm    = require('./lib/orm.js'),

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

function foodUrl(food) {
	return '/food/' + wordToUri(food.name);
}

var queries = {
	foods: 'SELECT * FROM foods',
	foods_insert: "INSERT INTO foods (name, type, cals, grams) VALUES ('<%= name %>', '<%= type %>', '<%= cals %>', '<%= grams %>')",
	foods_update: "UPDATE foods SET name='<%= name %>', type='<%= type %>', cals='<%= cals %>', grams='<%= grams %>' WHERE id=<%= id %>",
	ingredients: 'SELECT * from ingredients',
	ingredients_update: 'UPDATE ingredients SET grams=<%= grams %> WHERE food_id=<%= food_id %> AND ingredient_id=<%= update %>',
	ingredients_with_foods: 'SELECT i.food_id, i.ingredient_id, i.grams, ' +
		'f.id, f.name, f.type, f.cals, f.grams AS food_grams FROM ingredients i ' +
		'JOIN foods f ON i.ingredient_id=f.id'
};

function getFood(db, id) {
	return db.get(queries.food + condition({id: id}));
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

var helper = {
	number: function(digits, num) {
		var strs = (num + '').split('.');
		return strs[0] + (strs[1] ? '.' + strs[1].slice(0, digits) : '');
	},
	foodUrl: foodUrl
};

var actions = {
	root: function(match) {
		return dbM .pipe(function(db) {
			return db.all(queries.foods).pipe(function(foods) {
				var ms = _.map(foods, function(food) {
					if (food.type === 'ingredient') {
						return nodam.result(food);
					} else {
						return db.all(
							queries.ingredients_with_foods + condition({ food_id: food.id })
						). mmap(function(rows) {
							return _.map(rows, hydrateIngredient);
						}). pipe(function (ingredients) {
							food.ingredients = ingredients;
							if (food.grams) {
								food.cals = ingredients.reduce(function(sum, i) {
									return sum + i.food.cals * i.grams;
								}, 0) / food.grams;
							}

							return nodam.result(food);
						});
					}
				});

				return nodam.sequence(ms);
			});
		}).pipe(function(rows) {
			return getJade('views/foods.jade', { foods: rows, help: helper });
		}).pipe(success);
	},

	food: function(match) {
		return nodam.combine([dbM, getPost]).pipeArray(function(db, post) {
			if (post.delete) {
				return db.run('DELETE FROM foods ' + condition({ id: post.delete }));
			} else if (post.create) {
				return db.run(_.template(queries.foods_insert, {
					name: post.food_name,
					type: post.food_type,
					cals: post.food_cals || '',
					grams: post.food_grams || ''
				}));
			} else if (post.update) {
				return db.run(_.template(queries.foods_update, {
					name: post.food_name,
					type: post.food_type,
					cals: post.food_cals || '',
					grams: post.food_grams || '',
					id: post.update
				}));
			} else {
				// if nothing to do, send back to main page
				return nodam.result();
			}
		}).then(redirect('/'));
	},

	ingredients: function(match) {
		var food_name = match[1] && uriToWord(match[1]);
		if (! food_name) return error404;

		return dbM .pipe(function(db) {
			return db.get(
				queries.foods + condition({ name: food_name })
			).pipe(function(food) {
				var m;

				if (! food) {
					return error404;
				} else {
					if (food.type === 'dish') {
						m = db.all(
							queries.ingredients_with_foods + condition({ food_id: food.id }) + ' ORDER BY i.grams DESC'
						).pipe(function(ingredients) {
							return getJade('views/ingredients.jade', {
								ingredients: ingredients, food: food, food_url: foodUrl(food)
							});
						});
					} else {
						m = nodam.result(food_name + ' has no ingredients.')
					}

					return m.pipe(success);
				}
			});
		});
	},

	manageIngredients: function(match) {
		var food_name = match[1] && uriToWord(match[1]);
		if (! food_name) return error404;

		return nodam.combine([dbM, getPost]).pipeArray(function(db, post) {
			return db.get(
				queries.foods + condition({ name: food_name })
			).pipe(function(food) {
				var m;

				if (!food) {
					return error403('No such food: ' + food_name);
				} else if ('dish' !== food.type) {
					return error403(food_name + ' cannot have ingredients.');
				} else if (post.delete) {
					m = db.run(
						'DELETE FROM ingredients ' +
						condition({ food_id: post.food_id, ingredient_id: post.delete })
					);
				} else if (post.create) {
					m = db.get(
						queries.foods + condition({ name: post.ing_name })
					).pipe(function(ingred) {
						if (!ingred) return  nodam.result();

						return db.run(_.template(
							"INSERT INTO ingredients (food_id, ingredient_id, grams) VALUES (" + food.id + ", " +
							ingred.id + ", '<%= grams %>')", post))
					});
				} else if (post.update) {
					m = db.run(_.template(
						queries.ingredients_update,
						post
					));
				}

				if (m) {
					return m.then(redirect(match[0]));
				} else {
					return error403('Invalid form submission.');
				}
			});
		});
	}
};

var routes = [
	[ '/',        { GET: actions.root }],
	[ /\/food\/([\w\+-]+)/, { GET: actions.ingredients, POST: actions.manageIngredients }],
	[ /\/food(\/?)$/,     { POST: actions.food }]
];

nodam.http().createServer(function(request, response) {
	routeRequest(request, routes).or(error404).run(_.inert, function(err) {
			console.log(err);

			response.write('There was a problem with your request.');
			response.end();
		}, { request: request, response: response }
	);
}).listen(1337, '127.0.0.1');
