Error.stackTraceLimit = Infinity
process.on "error", (err) ->
  console.log err.stack

_ = require("../nodam/lib/curry.js")
orm = require("./lib/orm.js")
nodam = require("../nodam/lib/nodam.js")
sql = require("../nodam/lib/sqlite.js")
qs = require("querystring")
jade = require("jade")

model = require("./model.js")

fs = nodam.fs()
M = nodam.Maybe

GET = "GET"
POST = "POST"
PUT = "PUT"
DELETE = "DELETE"
dbM = model.dbM
queries = model.queries
fmap = _.flip(_.map)


# make code a little cleaner
runQueryM = (tmpl, data) ->
  dbM.pipe (db) ->
    db.run _.template(tmpl, data)

dbFunction = (name) ->
  (args...) ->
    dbM.pipe (db_obj) ->
      db_obj[name](args...)

dbGet = dbFunction('get')
dbAll = dbFunction('all')
dbRun = dbFunction('run')

showMonadErr = (err) ->
  console.log err.message
  console.log err.stack

  if err.monad
    m = _.clone(err.monad)
    delete m.stack_at_origin # show separately
    console.log m
    console.log 'Stack at origin:', err.monad.stack_at_origin

getJade = (file, data) ->
  fs.readFile(file, 'ascii').pipe (view) ->
    nodam.result jade.compile(view)(data)

error404 = nodam.get('response').pipe (resp) ->
  resp.status = 404
  resp.write 'Could not find requested URL'
  nodam.result resp.end()

error403 = (msg) ->
  nodam.get('response').pipe (resp) ->
    resp.status = 404
    resp.write msg
    nodam.result resp.end()

getPost = nodam.get('request').pipe (req) ->
  if req.method == POST
    postData = ''
    req.on 'data', (data) ->
      postData += data  if postData.length < 1000

    new nodam.AsyncMonad((r, f, s) ->
      req.on 'end', ->
        r qs.parse(postData), s

    )
  else
    nodam.result []

redirect = (url) ->
  nodam.get('response').pipe (resp) ->
    resp.statusCode = 302
    resp.setHeader 'Location', url

    nodam.result resp.end()

display = (resp, text) ->
  resp.setHeader 'Content-Type', 'text/html'
  resp.setHeader 'Content-Length', text.length
  resp.write text

  resp

success = (text) ->
  nodam.get('response').pipe (resp) ->
    resp.statusCode = 200
    nodam.result display(resp, text).end()

wordToUri = (word) -> word.replace RegExp(' ', 'g'), '+'
uriToWord = (word) -> word.replace /\+/g, ' '

matchUrl = (regexOrString, url) ->
  if regexOrString instanceof RegExp
    url.match regexOrString
  else
    if url == regexOrString then [url] else null

routeRequest = (request, routes) ->
  url = decodeURIComponent(request.url)
  method = request.method
  len = routes.length

  i = 0
  while i < len
    match = matchUrl(routes[i][0], url)
    if match
      action = routes[i][1] && routes[i][1][method]
      return M.just(action(match))  if action
    i++
  M.nothing

foodUrl = (food) -> '/food/' + wordToUri(food.name)
mealUrl = (meal) -> '/meal/' + meal.id

helper =
  number: (digits, num) ->
    strs = (num + '').split('.')
    strs[0] + (if strs[1] then '.' + strs[1].slice(0, digits) else '')

  foodUrl: foodUrl
  mealUrl: mealUrl

getView = (view, data) ->
  getJade('views/' + view + '.jade', _.set(data, 'help', helper))

actions =
  root: (match) ->
    dbM.pipe(model.allFoodsM).pipe((rows) ->
      getView('foods', foods: rows)
    ).pipe success

  food: (match) ->
    changes = getPost.pipe (post) ->
      if post['delete']
        dbRun 'DELETE FROM foods ' + orm.condition(id: post['delete'])
      else if post.create
        runQueryM(queries.foods_insert,
          name: post.food_name
          type: post.food_type
          cals: post.food_cals || ''
          grams: post.food_grams || ''
        )

      else if post.update
        runQueryM(queries.foods_update,
          name: post.food_name
          type: post.food_type
          cals: post.food_cals || ''
          grams: post.food_grams || ''
          id: post.update
        )

      else
        # if nothing to do, send back to main page
        nodam.result()

    changes.then redirect('/')

  ingredients: (match) ->
    food_name = match[1] && uriToWord(match[1])
    unless food_name
      return error404

    model.foodByName(food_name).pipe (food) ->
      if !food
        error404
      else
        m =
          if food.type == 'dish'
            model.ingredientsForFoodM(food).pipe (ingredients) ->
              getView('ingredients',
                ingredients: ingredients
                food: food
                food_url: foodUrl(food)
              )
          else
            nodam.result(food_name + ' has no ingredients.')

        m.pipe success


  manageIngredients: (match) ->
    food_name = match[1] && uriToWord(match[1])
    unless food_name
      return error404

    getPost.pipe (post) ->
      model.foodByName(food_name).pipe (food) ->
        unless food
          return error403('No such food: ' + food_name)

        unless 'dish' == food.type
          return error403(food_name + ' cannot have ingredients.')

        m =
          if post['delete']
            dbRun('DELETE FROM ingredients ' + orm.condition(
              food_id: food.id
              ingredient_id: post['delete']
            ))
          else if post.create
            model.foodByName(post.ing_name).pipe (ingred) ->
              unless ingred && ingred.id
                return nodam.result()

              runQueryM(queries.ingredients_insert,
                food_id: food.id
                ingred_id: ingred.id
                grams: post.grams || 0
              )
          else if post.update
            runQueryM(queries.ingredients_update, post)
          else false

        if m
          m.then(model.updateFoodCals(food)).then redirect(match[0])
        else
          error403 'Invalid form submission.'



  meals: (match) ->
    dbM.pipe nodam.pipeline([
      _.method('all', [queries.meals + ' ORDER BY created_at DESC']),
      (meals) -> getView('meals', meals: meals),
      success
    ])

  manageMeals: (match) ->
    nodam.combine([dbM, getPost]).pipeArray (db_obj, post) ->
      if post['delete']
        db_obj.run('DELETE FROM meals ' + orm.condition(id: post['delete']))
          .then redirect('/meals')
      else if post.create
        db_obj.run(queries.meals_insert) .then(
          db_obj.get(queries.meals + orm.condition(
            id: orm.literal('last_insert_rowid()')
          ))
        ).pipe(_.compose(redirect, mealUrl))
      else
        # if nothing to do, send back to meals
        redirect '/meals'

  meal: (match) ->
    unless match[1]
      return error404

    dbGet(queries.meals + orm.condition(id: match[1])).pipe (meal) ->
      if !meal
        error404
      else
        dbAll(
          queries.meal_foods_with_foods + orm.condition(meal_id: meal.id)
        ).mmap(
          _.curry(fmap, model.hydrateMealFood)
        ).pipe((meal_foods) ->
          getView('meal', { meal_foods: meal_foods, meal: meal })
        ).pipe success

  mealFoods: (match) ->
    meal_id = match[1]
    unless meal_id
      return error404

    nodam.combine([dbM, getPost]).pipeArray (db_obj, post) ->
      db_obj.get(queries.meals + orm.condition(id: meal_id)).pipe (meal) ->
        unless meal
          return error403('No meal with that id: ' + meal_id)

        if post['delete']
          m = db_obj.run('DELETE FROM meal_foods ' + orm.condition({
            meal_id: meal_id
            food_id: post['delete']
          }))
        else if post.create
          m = model.foodByName(post.food_name).pipe((food) ->
            if food
              console.log(food)
              runQueryM(queries.meal_foods_insert, {
                meal_id: meal_id
                food_id: food.id
                grams: post.grams
              })
            else
              nodam.result()
          )
        else if post.update
          m = runQueryM(queries.meal_foods_update, post)
        else return error403 'Invalid form submission.'

        m.then redirect(match[0])

routes = [
  [ '/',                  { GET: actions.root }],
  [ /\/food\/([\w\+-]+)/, { GET: actions.ingredients, POST: actions.manageIngredients }],
  [ /\/food(\/?)$/,       { POST: actions.food }],
  [ /\/meals(\/?)$/,      { GET: actions.meals }],
  [ /\/meal\/(\d+)/,      { GET: actions.meal, POST: actions.mealFoods }],
  [ /\/meal(\/?)$/,       { POST: actions.manageMeals }]
]

nodam.http().createServer((request, response) ->
  nodam.debug true

  routeRequest(request, routes).or(error404).run(((u) ->
  ), ((err) ->
    showMonadErr err
    response.write 'There was a problem with your request.'
    response.end()
  ), { request: request, response: response })
).listen(1337, '127.0.0.1')
