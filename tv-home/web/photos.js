// Fresh photos for the Night look's scenes (home.photos in config.json): real photographs from
// Wikimedia Commons, every one of them a Commons "featured picture" (picked by the Commons
// community) under a free licence. The TV asks Commons itself (free, no key), keeps the list on
// the TV, and asks again once a day. Each photo is shown with its title, photographer and licence,
// as the licences ask.
//
// Collections (home.photos.collections, in the order given; the first ones get the most places):
//   new-york, landscapes, culture, art, cities, nature
//
// Anything that goes wrong (no internet, Commons not answering) leaves the list that was there, or
// no fresh photos at all: the built-in scenes always stay.
(function () {
  var API = "https://commons.wikimedia.org/w/api.php";
  var FP = 'incategory:"Featured pictures on Wikimedia Commons"';
  var COLLECTIONS = {
    // no quoted phrases inside an OR group: Commons' search then finds nothing at all
    "new-york": FP + " (Manhattan OR Brooklyn OR NYC)",
    "landscapes": FP + " (landscape OR mountains OR lake OR valley OR fjord OR glacier)",
    "culture": FP + " (temple OR mosque OR cathedral OR festival OR market OR palace OR old town)",
    "art": FP + " (painting OR mural OR fresco OR museum)",
    "cities": FP + " (skyline OR cityscape OR panorama city OR night city)",
    "nature": FP + " (forest OR waterfall OR coast OR desert OR aurora)"
  };
  var KEY = "tvhome.photos";
  // Commons serves its picture copies from these two hosts (thumb. since 2026); nothing else is shown
  var HOST = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
  // Old archive photographs (black and white, 1900s) do not suit a living room: skipped, except in art.
  // Taken from the photo's own date; a photo with no date is kept.
  function tooOld(id, date) {
    if (id === "art") return false;
    var y = /\b(1[5-9]\d\d|20\d\d)\b/.exec(strip(date));
    return !!y && parseInt(y[1], 10) < 1960;
  }

  // Commons' credits are wiki text anyone can edit: read them in an inert document (nothing in it
  // runs or loads) and keep only the words
  function strip(html) {
    var s = String(html || ""), txt;
    try {
      var doc = new DOMParser().parseFromString(s, "text/html");
      Array.prototype.forEach.call(doc.querySelectorAll("script,style"), function (n) { n.remove(); });
      txt = doc.body.textContent;
    } catch (e) { txt = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "); }
    return String(txt || "").replace(/\s+/g, " ").trim();
  }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

  // One collection: up to 50 featured pictures, a different page of them each day, landscape-shaped
  // ones only (wider than 4:3, not a long panorama), as 1920-wide copies made by Commons.
  function fetchCollection(id, day) {
    var offset = ((day * 7) % 4) * 50;
    return fetchPage(id, offset).then(function (list) {
      // a small collection has fewer pages: start again from the first one
      return list.length || !offset ? list : fetchPage(id, 0);
    });
  }
  function fetchPage(id, offset) {
    var q = COLLECTIONS[id];
    if (!q) return Promise.resolve([]);
    var url = API + "?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=50" +
      "&gsroffset=" + offset + "&gsrsearch=" + encodeURIComponent(q + " filew:>1800") +
      "&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=1920" +
      "&iiextmetadatafilter=Artist%7CLicenseShortName%7CObjectName%7CDateTimeOriginal";
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var pages = (j.query && j.query.pages) || {};
      return Object.keys(pages).map(function (k) { return pages[k]; }).map(function (p) {
        var ii = p.imageinfo && p.imageinfo[0];
        if (!ii || ii.mime !== "image/jpeg" || !ii.thumburl || !ii.width || !ii.height) return null;
        if (!HOST.test(ii.thumburl)) return null;   // Commons' own picture servers only
        var ratio = ii.width / ii.height;
        if (ratio < 1.33 || ratio > 2.2 || (ii.thumbwidth || 0) < 1600) return null;
        var m = ii.extmetadata || {}, v = function (x) { return m[x] && m[x].value; };
        var lic = strip(v("LicenseShortName"));
        if (!lic) return null;   // no licence named: never shown
        if (tooOld(id, v("DateTimeOriginal"))) return null;
        return {
          id: "o" + p.pageid, src: ii.thumburl, coll: id,
          title: strip(v("ObjectName")) || strip(p.title).replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
          by: strip(v("Artist")).slice(0, 60), lic: lic
        };
      }).filter(Boolean);
    }, function () { return []; });
  }

  // Shuffled the same way all day, so the TV does not change its mind on every Home press
  function shuffle(list, seed) {
    var a = list.slice(), s = seed || 1;
    for (var i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; var k = Math.floor(s / 233280 * (i + 1)); var t = a[i]; a[i] = a[k]; a[k] = t; }
    return a;
  }

  // The day's pick: the collections take turns, the first ones a little more (two each to start),
  // up to count photos in all.
  function pick(lists, count) {
    var out = [], seen = {}, round = 0;
    while (out.length < count && lists.some(function (l) { return l.length; })) {
      lists.forEach(function (l, i) {
        var take = round === 0 && i < 1 ? 2 : 1;
        while (take-- > 0 && l.length && out.length < count) {
          var it = l.shift();
          if (!seen[it.id]) { seen[it.id] = 1; out.push(it); }
        }
      });
      round++;
    }
    return out;
  }

  window.PHOTOS_ONLINE = {
    // the list kept on the TV, straight away (or [] the first time)
    cached: function () { var c = load(); return c && Array.isArray(c.items) ? c.items : []; },
    // asks Commons again when the list is older than every_days; calls done(items) when it has a new one
    refresh: function (cfg, done) {
      var c = load(), every = Math.max(1, Math.min(30, parseInt(cfg.every_days, 10) || 1));
      var colls = (Array.isArray(cfg.collections) && cfg.collections.length ? cfg.collections : ["new-york", "landscapes", "culture", "art"])
        .filter(function (id) { return COLLECTIONS[id]; });
      var sig = colls.join(",");
      if (c && c.sig === sig && Date.now() - c.at < every * 86400000 && (c.items || []).length) return;
      if (window.MOCK_PHOTOS) { done(window.MOCK_PHOTOS); return; }   // previews (mock.js ?photos=1)
      var day = Math.floor(Date.now() / 86400000);
      Promise.all(colls.map(function (id) { return fetchCollection(id, day); })).then(function (lists) {
        var items = pick(lists.map(function (l, i) { return shuffle(l, day + i); }),
          Math.max(3, Math.min(30, parseInt(cfg.count, 10) || 12)));
        if (!items.length) return;   // nothing came back: keep what the TV had
        save({ at: Date.now(), sig: sig, items: items });
        done(items);
      });
    },
    collections: Object.keys(COLLECTIONS)
  };
})();
