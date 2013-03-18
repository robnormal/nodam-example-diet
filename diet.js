Error.stackTraceLimit = Infinity;
process.on('error', function (err) {
  console.log(err.stack);
});

var _      = require('../nodam/lib/curry.js');
_.debug(true);

var
	nodam  = require('../nodam/lib/nodam.js'),
	sql    = require('../nodam/lib/sqlite.js'),
	orm    = require('./lib/orm.js'),
	qs     = require('querystring'),
	jade   = require('jade'),

	model  = require('./model.js'),

	fs     = nodam.fs(),
	M      = nodam.Maybe;

var
	GET     = 'GET',
	POST    = 'POST',
	PUT     = 'PUT',
	DELETE  = 'DELETE',
	dbM     = model.dbM,
	queries = model.queries,
	fmap    = _.flip(_.map);

// make code a little cleaner
function runQueryM(tmpl, data) {
	return dbM.pipe(_.method('run', [_.template(tmpl, data)]));
}

function showMonadErr(err) {
	console.log(err.message);
	console.log(err.stack);

	if (err.monad) {
		var m = _.clone(err.monad);
		delete m.stack_at_origin; // show separately
		console.log(m);
		console.log('Stack at origin:', err.monad.stack_at_origin);
	}
}

function getJade(file, data) {
	return fs.readFile(file, 'ascii').pipe(function(view) {
		return nodam.result(jade.compile(view)(data));
	});
}

var error404 = nodam.get('response').pipe(function(resp) {
	resp.status = 404;
	resp.write('Could not find requested URL');
	
	return nodam.result(resp.end());
});

function error403(msg) {
	return nodam.get('response').pipe(function(resp) {
		resp.status = 404;
		resp.write(msg);
		
		return nodam.result(resp.end());
	});
}

var getPost = nodam.get('request') .pipe(function(req) {
	if (req.method === POST) {
		var postData = '';

		req.on('data', function (data) {
			if (postData.length < 1000) {
				postData += data;
			}
		});

		return new nodam.AsyncMonad(function(r, f, s) {
			req.on('end', function() {
				r(qs.parse(postData), s);
			});
		});
	} else {
		return nodam.result([]);
	}
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

function matchUrl(regexOrString, url) {
	if (regexOrString instanceof RegExp) {
		return url.match(regexOrString);
	} else {
		return url === regexOrString ? [url] : null;
	}
}

function routeRequest(request, routes) {
	var
		url    = decodeURIComponent(request.url),
		method = request.method,
		len    = routes.length,
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

function foodUrl(food) {
	return '/food/' + wordToUri(food.name);
}

function mealUrl(meal) {
	return '/meal/' + meal.id;
}

var helper = {
	number: function(digits, num) {
		var strs = (num + '').split('.');
		return strs[0] + (strs[1] ? '.' + strs[1].slice(0, digits) : '');
	},
	foodUrl: foodUrl,
	mealUrl: mealUrl
};

function getView(view, data) {
	return getJade('views/' + view + '.jade', _.set(data, 'help', helper));
}

var actions = {
	root: function(match) {
		return dbM
			.pipe(model.allFoodsM)
			.pipe(function(rows) {
				return getView('foods', { foods: rows });
			})
			.pipe(success);
	},

	food: function(match) {
		return nodam.combine([dbM, getPost]).pipeArray(function(db, post) {
			if (post['delete']) {
				return db.run('DELETE FROM foods ' + orm.condition({ id: post['delete'] }));
			} else if (post.create) {
				return runQueryM(queries.foods_insert, {
					name: post.food_name,
					type: post.food_type,
					cals: post.food_cals || '',
					grams: post.food_grams || ''
				});
			} else if (post.update) {
				return runQueryM(queries.foods_update, {
					name: post.food_name,
					type: post.food_type,
					cals: post.food_cals || '',
					grams: post.food_grams || '',
					id: post.update
				});
			} else {
				// if nothing to do, send back to main page
				return nodam.result();
			}
		}).then(redirect('/'));
	},

	ingredients: function(match) {
		var food_name = match[1] && uriToWord(match[1]);
		if (! food_name) return error404;

		return model.foodByName(food_name) .pipe(function(food) {
			var m;

			if (! food) {
				return error404;
			} else {
				if (food.type === 'dish') {
					m = model.ingredientsForFoodM(food) .pipe(function(ingredients) {
						return getView('ingredients', {
							ingredients: ingredients, food: food, food_url: foodUrl(food)
						});
					});
				} else {
					m = nodam.result(food_name + ' has no ingredients.')
				}

				return m.pipe(success);
			}
		});
	},

	manageIngredients: function(match) {
		var food_name = match[1] && uriToWord(match[1]);
		if (! food_name) return error404;

		return nodam.combine([dbM, getPost]).pipeArray(function(db, post) {
			return model.foodByName(food_name) .pipe(function(food) {
				if (! food) {
					return error403('No such food: ' + food_name);
				}
				if ('dish' !== food.type) {
					return error403(food_name + ' cannot have ingredients.');
				}
				
				var m;
				if (post['delete']) {
					m = db.run(
						'DELETE FROM ingredients ' +
						orm.condition({ food_id: food.id, ingredient_id: post['delete'] })
					);
				} else if (post.create) {
					m = model.foodByName(post.ing_name) .pipe(function(ingred) {
						if (!ingred || !ingred.id) return  nodam.result();

						return runQueryM(queries.ingredients_insert, {
							food_id:   food.id,
							ingred_id: ingred.id,
							grams:     post.grams || 0
						});
					});
				} else if (post.update) {
					m = runQueryM(queries.ingredients_update, post);
				}

				if (m) {
					return m
						.then(model.updateFoodCals(food))
						.then(redirect(match[0]));
				} else {
					return error403('Invalid form submission.');
				}
			});
		});
	},

	meals: function(match) {
		return dbM.pipe(nodam.pipeline([
			_.method('all', [queries.meals + ' ORDER BY created_at DESC']),
			function(meals) {
				return getView('meals', { meals: meals });
			},
			success
		]));
	},

	manageMeals: function(match) {
		return nodam.combine([dbM, getPost]).pipeArray(function(db, post) {
			if (post['delete']) {
				return db.run(
						'DELETE FROM meals ' + orm.condition({ id: post['delete'] })
					)
					.then(redirect('/meals'));
			} else if (post.create) {
				return db
					.run(queries.meals_insert)
					.then(db.get(
						queries.meals + orm.condition({ id: orm.literal('last_insert_rowid()') })
					))
					.pipe(_.compose(redirect, mealUrl));
			} else {
				// if nothing to do, send back to meals
				return redirect('/meals');
			}
		});
	},

	meal: function(match) {
		if (! match[1]) return error404;

		return dbM .pipe(function(db) {
			return db.get(
				queries.meals + orm.condition({ id: match[1] })
			).pipe(function(meal) {
				if (! meal) {
					return error404;
				} else {
					return db.all(
						queries.meal_foods_with_foods + orm.condition({ meal_id: meal.id })
					)
					.mmap(_.curry(fmap, model.hydrateMealFood))
					.pipe(function(meal_foods) {
						return getView('meal', { meal_foods: meal_foods, meal: meal });
					})
					.pipe(success);
				}
			});
		});
	},

	mealFoods: function(match) {
		var meal_id = match[1];
		if (! meal_id) return error404;

		return nodam.combine([dbM, getPost]).pipeArray(function(db, post) {
			return db.get(
				queries.meals + orm.condition({ id: meal_id })
			).pipe(function(meal) {
				if (! meal) {
					return error403('No meal with that id: ' + meal_id);
				}

				var m, q;
				if (post['delete']) {
					m = db.run('DELETE FROM meal_foods ' + orm.condition(
						{ meal_id: meal_id, food_id: post['delete'] }
					));
				} else if (post.create) {
					m = model.foodByName(db, post.food_name) .pipe(function(food) {
						return food ?
							runQueryM(queries.meal_foods_insert, post) :
							nodam.result();
					});
				} else if (post.update) {
					m = runQueryM(queries.meal_foods_update, post);
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
	[ '/',                  { GET: actions.root }],
	[ /\/food\/([\w\+-]+)/, { GET: actions.ingredients, POST: actions.manageIngredients }],
	[ /\/food(\/?)$/,       { POST: actions.food }],
	[ /\/meals(\/?)$/,      { GET: actions.meals }],
	[ /\/meal\/(\d+)/,      { GET: actions.meal, POST: actions.mealFoods }],
	[ /\/meal(\/?)$/,       { POST: actions.manageMeals }]
];

nodam.http().createServer(function(request, response) {
	nodam.debug(true);

	routeRequest(request, routes).or(error404).run(function(u) {
	}, function(err) {
		showMonadErr(err);

		response.write('There was a problem with your request.');
		response.end();
	}, { request: request, response: response });
}).listen(1337, '127.0.0.1');
