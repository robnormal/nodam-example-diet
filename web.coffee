_ = require("../nodam/lib/curry.js")
nodam = require("../nodam/lib/nodam-basic.js")
sql = require("../nodam/lib/sqlite-basic.js")
R = require('../nodam/lib/restriction.js')
orm = require("./lib/orm.js")
model = require("./model.js")

qs = require('querystring')
jade = require('jade')

fs = nodam.fs()
M = nodam.Maybe

GET = 'GET'
POST = 'POST'
PUT = 'PUT'
DELETE = 'DELETE'

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

    new nodam.AsyncMonad((apass) ->
      req.on('end', ->
        apass.success(M.right(qs.parse(postData)), apass.state)
      )
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

helper =
  number: (digits, num) ->
    strs = (num + '').split('.')
    strs[0] + (if strs[1] then '.' + strs[1].slice(0, digits) else '')

getView = (view, data) ->
  getJade('views/' + view + '.jade', _.set(data, 'help', helper))

showView = (view, data) -> getView(view, data).pipe success

logError = (msg) -> fs.writeFile('errors.log', msg)

showMonadErr = (err) ->
  console.log(err)
  console.log err.message
  console.log err.stack

  if err.monad
    m = _.clone(err.monad)
    delete m.stack_at_origin # show separately
    console.log m
    console.log 'Stack at origin:', err.monad.stack_at_origin

module.exports =
  getJade: getJade
  error404: error404
  error403: error403
  getPost: getPost
  redirect: redirect
  display: display
  success: success
  wordToUri: wordToUri
  uriToWord: uriToWord
  matchUrl: matchUrl
  routeRequest: routeRequest
  helper: helper
  getView: getView
  showView: showView
  showMonadErr: showMonadErr


