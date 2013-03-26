_ = require("../nodam/lib/curry.js")
nodam = require("../nodam/lib/nodam.js")
sql = require("../nodam/lib/sqlite.js")
R = require('../nodam/lib/restriction.js')
orm = require("./lib/orm.js")
model = require("./model.js")

qs = require('querystring')
jade = require('jade')
util = require('util')

fs = nodam.fs()
M = nodam.Maybe
E = nodam.Either

GET = 'GET'
POST = 'POST'
PUT = 'PUT'
DELETE = 'DELETE'

WebFailure = (@err) ->

util.inherits(WebFailure, nodam.AsyncFailure)

webFailure = (statusCode, text) ->
  nodam.get('response').pipe (resp) ->
    resp.writeHead(statusCode)
    resp.write text
    resp.end()

    new WebFailure({ status: statusCode, text: text })

getJade = (file, data) ->
  fs.readFile(file, 'ascii').pipe (view) ->
    nodam.result jade.compile(view, { filename: file })(data)

error404 = webFailure(404, 'Could not find requested URL')
error403 = (msg) -> webFailure(403, msg.toString())

getPost = nodam.get('request').pipe (req) ->
  if req.method == POST
    postData = ''
    req.on 'data', (data) ->
      postData += data  if postData.length < 1000

    new nodam.Async((apass) ->
      req.on('end', ->
        parsed = qs.parse(postData)

        reParsed = _.reduce(parsed, (memo, val, key) ->
          newKey = key.replace(/\[\]$/, '')
          if newKey
            memo[newKey] = val

          memo
        , {})

        apass.success(E.right(reParsed), apass.state)
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

wordToUri = (word) -> encodeURIComponent(word).replace(RegExp('%20', 'g'), '+')
uriToWord = (word) -> decodeURIComponent word.replace(/\+/g, '%20')

matchUrl = (regexOrString, url) ->
  if regexOrString instanceof RegExp
    url.match regexOrString
  else
    if url == regexOrString then [url] else null

routeRequest = (request, routes) ->
  url = decodeURIComponent(request.url)
  method = request.method
  len = routes.length

  i = -1; while ++i < len
    match = matchUrl(routes[i][0], url)
    if match
      action = routes[i][1] && routes[i][1][method]
      if action
        return M.just(action(match))
  M.nothing

helper =
  number: (digits, num) ->
    mult = 1
    i = -1; while ++i < digits
      mult = mult * 10

    Math.round(num * mult) / mult

getView = (view, data) ->
  getJade('views/' + view + '.jade', _.set(data, 'help', helper))

showView = (view, data) -> getView(view, data).pipe success

logError = (msg) -> fs.writeFile('errors.log', msg)

showMonadErr = (err) ->
  console.log('err:',err)
  console.log('message:', err.message)
  console.log('stack:',err.stack)

  if err.monad
    m = _.clone(err.monad)
    delete m.stack_at_origin # show separately
    console.log('monad:', m)
    console.log('Stack at origin:', err.monad.stack_at_origin)

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


