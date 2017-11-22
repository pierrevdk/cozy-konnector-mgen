const {BaseKonnector, request, log, saveFiles, saveBills} = require('cozy-konnector-libs')
const moment = require('moment')
const bluebird = require('bluebird')

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
  .then(connector.getSectionsUrls)
  .then(sections => {
    return connector.fetchAttestationMutuelle(sections.mutuelle, fields)
    .then(() => connector.fetchRemboursements(sections.remboursements))
  })
  .then(entries => saveBills(entries, fields.folderPath, {
    timeout: Date.now() + 60 * 1000,
    identifiers: 'MGEN'
  }))
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

connector.getSectionsUrls = function ($) {
  const result = {}
  const $linkMutuelle = $("a[href*='attestation-de-droit-regime-complementaire']")
  const matriceMutuelle = $linkMutuelle.closest('[data-tag-metier-attestations-demarches]').attr('data-matrice')
  const urlMutuelle = unescape($linkMutuelle.attr('href'))
  result.mutuelle = `${baseUrl}${urlMutuelle}&codeMatrice=${matriceMutuelle}`

  const $linkRemboursements = $("a[href*='mes-remboursements']")
  const matriceRemboursements = $linkRemboursements.closest('[data-tag-metier-remboursements]').attr('data-matrice')
  const urlRemboursements = unescape($linkRemboursements.attr('href'))
  result.remboursements = `${baseUrl}${urlRemboursements}&codeMatrice=${matriceRemboursements}`

  log('debug', result, 'SectionsUrls')

  return result
}

function serializedFormToFormData (data) {
  return data.reduce((memo, item) => {
    memo[item.name] = item.value
    return memo
  }, {})
}

connector.fetchRemboursements = function (url, fields) {
  return rq(url)
  .then($ => {
    const $form = $('#formRechercheRemboursements')
    const formData = serializedFormToFormData($form.serializeArray())

    // update dateDebut to 1 year before
    formData.dateDebut = moment(formData.dateFin, 'DD/MM/YYYY').subtract(6, 'months').format('DD/MM/YYYY')

    return rq({
      url: baseUrl + unescape($form.attr('action')),
      method: 'POST',
      formData
    })
    .then($ => {
      // table parsing
      const entries = Array.from($('#tableDernierRemboursement tbody tr')).map(tr => {
        const tds = Array.from($(tr).find('td')).map(td => {
          return $(td).text().trim()
        })

        return {
          type: 'health',
          vendor: 'MGEN',
          isRefund: true,
          indexLigne: tds[0],
          originalDate: moment(tds[1], 'DD/MM/YYYY').toDate(),
          beneficiary: tds[2],
          amount: parseFloat(tds[3].replace(' €', '').replace(',', '.')),
          date: moment(tds[4], 'DD/MM/YYYY').toDate()
        }
      })

      // try to get details for the first line
      const $formDetails = $('#formDetailsRemboursement')
      const formData = serializedFormToFormData($formDetails.serializeArray())
      formData['tx_mtechremboursement_mtechremboursementsante[rowIdOrder]'] = entries.map(entry => entry.indexLigne).join(',')
      const action = unescape($formDetails.attr('action'))

      return bluebird.mapSeries(entries, entry => connector.fetchDetailsRemboursement(entry, action, formData))
    })
  })
}

connector.fetchDetailsRemboursement = function (entry, action, formData) {
  formData['tx_mtechremboursement_mtechremboursementsante[indexLigne]'] = entry.indexLigne
  return rq({
    url: baseUrl + action,
    method: 'POST',
    formData
  })
  .then($ => {
    const $table = $('#ajax-details-remboursements table').eq(0).find('tbody')
    const data = Array.from($table.find('tr')).reduce((memo, tr) => {
      const $tds = $(tr).find('td')
      memo[$tds.eq(0).text().trim()] = $tds.eq(1).text().trim()
      return memo
    }, {})

    entry.subtype = data.Prescripteur

    if (data['Remboursement à l\'assuré'] === '0,00 €') {
      entry.isThirdPartyPayer = true
      entry.amount = 0
    }

    entry.originalAmount = parseFloat(data['Montant des soins'].replace(' €', '').replace(',', '.'))

    return entry
  })
}

connector.fetchAttestationMutuelle = function (url, fields) {
  return rq(url)
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
