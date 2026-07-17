# Level0 Reborn

[Level0](https://github.com/zverik/level0) version that works completely in your browser. 

Demo: https://deevroman.github.io/level0-reborn

⚠️ The editor is still in development, and there may be problems in it. 

However, you can already make simple tag changes.

## Features

- It works in your browser and with any OSM server
- Split upload
- ESRI Satellite layer
- Display all downloaded data on map
- Search and Replace
- You can copy data from the main server to the OSM Sandbox ( inspired by https://github.com/Zverik/osm_to_sandbox)
- Dark theme 

... in progress

- [ ] polishing the UX/UI
- [ ] Overpass query editor
- [ ] Custom changeset split
- [ ] i18n

p.s. Let me know if you are interested in this editor or some features

## Dev Notes

- `npm test`
- `npm run lint`
- `src/js/app.js` wires DOM, auth flow and data loading.
- `src/js/overpass.js` converts Overpass JSON into Level0L text.
- `src/js/level0l.js` parses Level0L and builds `osmChange`.
