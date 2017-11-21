const {BaseKonnector, request, log, saveFiles} = require('cozy-konnector-libs')

let rq = request({
  cheerio: true,
  json: false,
  // debug: true,
  jar: true
})

const baseUrl = 'https://www.mgen.fr'

const connector = new BaseKonnector(start)

function start (fields) {
  return connector.logIn(fields)
  .then($ => connector.fetchAttestationMutuelle($, fields))
}

connector.logIn = function (fields) {
  return rq({
    url: 'https://www.mgen.fr/login-adherent/',
    method: 'POST',
    formData: {
      typeConnexion: 'adherent',
      user: fields.login,
      pass: [fields.password],
      logintype: 'login',
      redirect_url: '/mon-espace-perso/'
    }
  })
}

connector.fetchAttestationMutuelle = function ($, fields) {
  const $link = $("a[href*='attestation-de-droit-regime-complementaire']")
  const matrice = $link.closest('[data-tag-metier-attestations-demarches]').attr('data-matrice')
  let url = unescape($link.attr('href'))

  return rq(`${baseUrl}${url}&codeMatrice=${matrice}`)
  .then($ => {
    const script = $('#panelAttestationDroitRO').prev('script').html()
    log('debug', script, 'script')
    const urls = script.trim().split('\n').map(line => unescape(line.match(/'(.*)'/)[1]))
    log('debug', urls, 'urls')

    return rq({
      method: 'POST',
      url: baseUrl + urls[0],
      formData: {
        identifiantPersonne: '0',
        modeEnvoi: 'telecharger'
      }
    })
    .then(() => ({
      fileurl: baseUrl + urls[1],
      filename: 'Attestation_mutuelle.pdf',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:36.0) Gecko/20100101 Firefox/36.0'
        }
      }
    }))
  })
  .then(entry => saveFiles([entry], fields))
}

module.exports = connector
