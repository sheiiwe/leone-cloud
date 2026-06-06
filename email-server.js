const nodemailer = require('nodemailer')

// Trasporto Email normale Aruba
const transportEmail = nodemailer.createTransport({
  host: 'smtps.aruba.it',
  port: 465,
  secure: true,
  auth: {
    user: 'amministrazione@leoneconsultingitalia.it',
    pass: 'LeonSheiiwe_1995'
  }
})

// Trasporto PEC Aruba
const transportPEC = nodemailer.createTransport({
  host: 'smtp.pec.aruba.it',
  port: 465,
  secure: true,
  auth: {
    user: 'amministratore@pec.leoneconsultingitalia.it',
    pass: 'Sekfeh-1simne-zuzvog'
  }
})

module.exports = { transportEmail, transportPEC }
