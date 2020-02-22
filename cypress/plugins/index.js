const fetch = require('node-fetch')

module.exports = (on, config) => {
  on('task', {
    sitemapUrls() {
      return fetch('http://localhost:3000/sitemap.xml', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/xml',
        },
      })
        .then(res => res.text())
        .then(xml => {
          const locs = [...xml.matchAll(`<loc>(.|\n)*?</loc>`)].map(([loc]) =>
            loc
              .replace('<loc>', '')
              .replace('</loc>', '')
              .replace('https://timdeschryver.dev', ''),
          )
          return locs
        })
    },
  })
  return config
}
