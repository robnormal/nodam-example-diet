Error.stackTraceLimit = Infinity
process.on "error", (err) ->
  console.log err.stack

_ = require("../nodam/lib/curry.js")
nodam = require("../nodam/lib/nodam.js")
sql = require("../nodam/lib/sqlite.js")
R = require('../nodam/lib/restriction.js')
orm = require("./lib/orm.js")
model = require("./model.js")

qs = require("querystring")
jade = require("jade")

fs = nodam.fs()
M = nodam.Maybe

GET = "GET"
POST = "POST"
PUT = "PUT"
DELETE = "DELETE"
dbM = model.dbM
queries = model.queries
fmap = _.flip(_.map)

logError = (msg) -> fs.writeFile('errors.log', msg)

# make code a little cleaner
runQuery = (tmpl, data) ->
  R.manualCheck(tmpl && (typeof tmpl == 'string'), 'Expected query template')
  dbM.pipe (db) ->
    db.run _.template(tmpl, data)

dbFunction = (name) ->
  (args...) ->
    dbM.pipe (db_obj) ->
      db_obj[name](args...)

dbQueryFunction = (name) ->
  (query, args...) ->
    R.manualCheck(query && (typeof query == 'string'), 'Expected SQL query')

    dbM.pipe (db_obj) ->
      db_obj[name](query, args...)

dbGet = dbQueryFunction('get')
dbAll = dbQueryFunction('all')
dbRun = dbQueryFunction('run')
dbEach = dbQueryFunction('eachM')

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
      if action
        return M.just(action(match))
    i++
  M.nothing

foodUrl = (food) -> '/food/' + wordToUri(food.name)
mealUrl = (meal) -> '/meal/' + meal.id
planUrl = (plan) -> '/plan/' + wordToUri(plan.name)

setMealCals = (meal) ->
  cals = _.reduce(meal.foods, (memo, m_food) ->
    memo + m_food.cals
  , 0)

  _.set(meal, 'cals', cals)

helper =
  number: (digits, num) ->
    strs = (num + '').split('.')
    strs[0] + (if strs[1] then '.' + strs[1].slice(0, digits) else '')

  foodUrl: foodUrl
  mealUrl: mealUrl
  planUrl: planUrl

getView = (view, data) ->
  getJade('views/' + view + '.jade', _.set(data, 'help', helper))

showView = (view, data) -> getView(view, data).pipe success

deleteFood = (post) ->
  dbRun('DELETE FROM foods ' + orm.condition(id: post['delete']))

createFood = (post) ->
  runQuery(queries.foods_insert,
    name: post.food_name
    type: post.food_type
    cals: post.food_cals || ''
    grams: post.food_grams || ''
  )

updateFood = (post) ->
  runQuery(queries.foods_update,
    name: post.food_name
    type: post.food_type
    cals: post.food_cals || ''
    grams: post.food_grams || ''
    id: post.update
  )

getIngredients = (food) ->
  m =
    if food.type == 'dish'
      model.ingredientsForFood(food).pipe (food2) ->
        getView('ingredients',
          ingredients: food2.ingredients
          food: food2
          food_url: foodUrl(food2)
        )
    else
      nodam.result(food.name + ' has no ingredients.')

deleteIngredient = (post, food) ->
  dbRun('DELETE FROM ingredients ' + orm.condition(
    food_id: food.id
    ingredient_id: post['delete']
  ))

createIngredient = (post, food) ->
  model.foodByName(post.ing_name).pipe (ingred) ->
    unless ingred && ingred.id
      return nodam.result()

    runQuery(queries.ingredients_insert,
      food_id: food.id
      ingred_id: ingred.id
      grams: post.grams || 0
    )

deleteMealFood = (meal_id, food_id) ->
  dbRun('DELETE FROM meal_foods ' + orm.condition({
    meal_id: meal_id
    food_id: post_id
  }))

# meal -> IO meal
fillMealFoods = (meal) ->
  dbAll(
    queries.meal_foods_with_foods + orm.condition(meal_id: meal.id)
  ).mmap(
    _.curry(fmap, model.hydrateMealFood)
  ).pipe (meal_foods) ->
    meal2 = _.set(meal, 'foods', meal_foods)
    nodam.result setMealCals(meal2)

createMealFood = (meal, post) ->
  model.foodByName(post.food_name).pipe (food) ->
    if !food
      nodam.result()
    else
      # if meal food exists, add the grams of the new entry to that
      model.getMealFood(meal.id, food.id).pipe (m_food) ->
        post_grams = parseInt(post.grams, 10)

        if m_food
          runQuery(queries.meal_foods_update,
            meal_id: meal.id
            food_id: food.id
            grams: m_food.grams + post_grams
          )
        else
          runQuery(queries.meal_foods_insert, {
            meal_id: meal.id
            food_id: food.id
            grams: post_grams
          })

updateMealFood = (meal, post) ->
  runQuery(queries.meal_foods_update,
    meal_id: meal.id
    food_id: post.update
    grams: post.grams
  )

actions = {
  root: (match) ->
    model.allFoods.pipe (rows) ->
      showView('foods', foods: rows)

  food: (match) ->
    changes = getPost.pipe (post) ->
      if post['delete']
        deleteFood post
      else if post.create
        createFood post
      else if post.update
        updateFood post
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
        getIngredients(food).pipe success


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
            deleteIngredient(post, food)
          else if post.create
            createIngredient(post, food)
          else if post.update
            runQuery(queries.ingredients_update, post)
          else false

        if m
          m.then(model.updateFoodCals(food)).then redirect(match[0])
        else
          error403 'Invalid form submission.'


  meals: (match) ->
    dbAll(queries.meals + ' ORDER BY created_at DESC').pipe (meals) ->
      showView('meals', meals: meals)

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
        fillMealFoods(meal).pipe (mealFilled) ->
          showView('meal', { meal_foods: mealFilled.foods, meal: mealFilled })

  mealFoods: (match) ->
    meal_id = match[1]
    unless meal_id
      return error404

    nodam.combine([dbM, getPost]).pipeArray (db_obj, post) ->
      dbGet(queries.meals + orm.condition(id: meal_id)).pipe (meal) ->
        unless meal
          return error403('No meal with that id: ' + meal_id)

        e_m =
          if post['delete']
            M.right deleteMealFood(meal_id, post['delete'])
          else if post.create
            M.right createMealFood(meal, post)
          else if post.update
            M.right updateMealFood(meal, post)
          else M.left 'Invalid form submission.'

        e_m.fromEither(
          (m) -> m.then redirect(match[0])
          (str) -> error403 str
        )

  foodList: (match) ->
    term = match[2]
    (
      if term
        dbAll(_.template(
          model.queries.food_list,
          { term: term }
        )).mmap (rows) ->
          if rows
            JSON.stringify(_.map(rows, (row) -> row.name))
          else
            nodam.result('')
      else
        nodam.result('')
    ).pipe success

  plans: (match) ->
    dbAll(queries.plans).pipe (plans) ->
      showView('plans', plans: plans)

  planMeals: (match) ->
    plan_name = match[1] && uriToWord(match[1])

    dbGet(queries.plans + orm.condition(name: plan_name)).pipe (plan) ->
      unless plan
        return error403('No plan "' + plan_name + '" exists.')

      dbAll(queries.plan_meals + orm.condition(plan_id: plan.id))
        .pipe((meals) ->
          if meals && meals.length
            nodam.sequence _.map(meals, fillMealFoods)
          else
            nodam.result []
        )
        .pipe (mealsFilled) ->
          showView('plan', plan: _.set(plan, 'meals', mealsFilled))


  createPlan: (match) ->
    nodam.combine([dbM, getPost]).pipeArray (db_obj, post) ->
      e_m =
        if post.create
          createPlan(post)
        else M.left('Invalid form submission.')

      e_m.either(
        (m) -> m.pipe(_.compose(redirect, planUrl))
        (err) -> error403 err
      )

  managePlan: (match) ->
    nodam.combine([dbM, getPost]).pipeArray (db_obj, post) ->
      m =
        if post.create
          createPlan(post)
        else
          dbGet(queries.plans + orm.condition(id: plan_id)).pipe (plan) ->
            if !plan
              nodam.result M.left('No plan with that id: ' + plan_id)
            else if post['delete']
              deletePlan(plan)
            else if post.update
              updatePlan(plan, post)
            else nodam.result M.left('Invalid form submission.')

      m.pipe (e_m_err) ->
        e_m_err.either(
          (m) -> m.then redirect(match[0])
          (err) -> error403 err
        )

}

createPlan = (post) ->
  if post.name
    M.right runQuery(model.queries.plans_insert, { name: post.name })
      .then(
        dbGet(queries.plans + orm.condition(
          id: orm.literal('last_insert_rowid()')
        ))
      )
  else
    nodam.result M.left('Invalid form submission.')

routes = [
  [ '/',                  { GET: actions.root }]
  [ /^\/food\/([\w\+-]+)/, { GET: actions.ingredients, POST: actions.manageIngredients }]
  [ /^\/food(\/?)$/,       { POST: actions.food }]
  [ /^\/meals(\/?)$/,      { GET: actions.meals }]
  [ /^\/meal\/(\d+)/,      { GET: actions.meal, POST: actions.mealFoods }]
  [ /^\/meal(\/?)$/,       { POST: actions.manageMeals }]
  [ /^\/plans(\/?)$/,       { GET: actions.plans }]
  [ /^\/plan(\/?)$/,       { POST: actions.managePlan }]
  [ /^\/plan\/([\w\+-]+)/, { GET: actions.planMeals, POST: actions.managePlan }]

  [ /^\/foodlist(\/?)\?term=(\w*)/,   { GET: actions.foodList }]
]

nodam.http().createServer((request, response) ->
  nodam.debug true

  routeRequest(request, routes).or(error404)
    .run(
      _.inert,
      ((err) ->
        showMonadErr err
        response.write 'There was a problem with your request.'
        response.end()
      ),
      { request: request, response: response }
    )
).listen(1337, '127.0.0.1')
