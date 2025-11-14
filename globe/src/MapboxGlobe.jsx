import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Trash2, Edit3 } from 'lucide-react'

// Simple, small markdown renderer and sanitizer (avoids external deps so Vite doesn't fail).
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderMarkdown(md) {
  if (!md) return ''
  // escape first
  let s = escapeHtml(md)
  // basic bold **text**
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  // italics *text*
  s = s.replace(/\*(.*?)\*/g, '<em>$1</em>')
  // unordered lists: lines starting with - 
  s = s.replace(/^- (.*)$/gm, '<li>$1</li>')
  if (s.indexOf('<li>') !== -1) {
    s = s.replace(/(<li>[\s\S]*<\/li>)/gm, function (m) {
      // wrap consecutive list items in ul
      const items = m.match(/<li>[\s\S]*?<\/li>/g) || []
      return '<ul>' + items.join('') + '</ul>'
    })
  }
  // convert double newlines to paragraphs
  s = s.replace(/\n\n+/g, '</p><p>')
  // single newlines to <br>
  s = s.replace(/\n/g, '<br/>')
  // wrap in paragraph if not already html
  if (!/^<\/?(p|ul|h|div)/i.test(s)) s = '<p>' + s + '</p>'
  return s
}
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

// Uses Vite env variable VITE_MAPBOX_TOKEN. Create a .env with:
// VITE_MAPBOX_TOKEN=your_token_here
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export default function MapboxGlobe() {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)

  // UI state
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loadingSuggest, setLoadingSuggest] = useState(false)
  const [selected, setSelected] = useState(null)
  const [mode, setMode] = useState('facts') // facts, story, travel, lore
  const [activeIndex, setActiveIndex] = useState(-1)
  const suggestTimer = useRef(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [aiContent, setAiContent] = useState(null)
  const [loadingAI, setLoadingAI] = useState(false)
  const openaiKey = import.meta.env.VITE_OPENAI_KEY
  const [markersEnabled, setMarkersEnabled] = useState(false)
  const [infographicsOpen, setInfographicsOpen] = useState(false)
  const [legendItems, setLegendItems] = useState([{ id: 1, color: '#6b7cff', label: 'Point of Interest' }])
  const [markerColor, setMarkerColor] = useState('#6b7cff')
  const [infographicsTab, setInfographicsTab] = useState('markers') // 'markers' or 'drawings'
  const markersRef = useRef([])
  const legendMarkersRef = useRef({}) // map of legendItem.id -> mapbox marker
  const [lastClick, setLastClick] = useState(null) // {lat,lng,placeName}

  // legend / infographics helpers
  const addLegendItem = (opts = {}) => {
    const map = mapRef.current
    const id = Date.now()
    const color = opts.color || '#ff5b5b'
    const label = opts.label || 'New item'
    // add to state
    setLegendItems((s) => [...s, { id, color, label }])

    // also add a draggable marker on the map at current center (if map ready)
    if (map) {
      const center = map.getCenter()
      const el = document.createElement('div')
      el.className = 'marker-pin'
      el.style.backgroundColor = color
      const pulse = document.createElement('span')
      pulse.className = 'pin-pulse'
      pulse.style.boxShadow = `0 0 0 6px ${color}33`
      el.appendChild(pulse)
      const marker = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat([center.lng, center.lat]).addTo(map)
      // optional: attach popup with label
      try {
        marker.getElement().title = label
      } catch (e) { void e }
      legendMarkersRef.current[id] = marker
    }
    return id
  }

  const updateLegendItem = (id, patch) => {
    setLegendItems((s) => s.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    // update marker appearance if exists
    const m = legendMarkersRef.current[id]
    if (m) {
      const el = m.getElement()
      if (patch.color) {
        el.style.backgroundColor = patch.color
        const pulse = el.querySelector('.pin-pulse')
        if (pulse) pulse.style.boxShadow = `0 0 0 6px ${patch.color}33`
      }
      if (patch.label) {
        try { el.title = patch.label } catch (e) { void e }
      }
    }
  }

  const removeLegendItem = (id) => {
    setLegendItems((s) => s.filter((it) => it.id !== id))
    const m = legendMarkersRef.current[id]
    if (m) {
      try { m.remove() } catch (e) { void e }
      delete legendMarkersRef.current[id]
    }
  }

  // helper to clear markers
  const clearMarkers = useCallback(() => {
    if (markersRef.current && markersRef.current.length) {
      markersRef.current.forEach((m) => {
        try { m.remove() } catch (e) { void e }
      })
      markersRef.current = []
    }
  }, [])

  const clearMarkersRef = useRef(clearMarkers)
  useEffect(() => {
    clearMarkersRef.current = clearMarkers
  }, [clearMarkers])

  // helper to add a single pulsing marker and ensure previous markers are removed
  const addMarker = useCallback((lng, lat) => {
    const map = mapRef.current
    if (!map) return null
    // remove existing markers first
    clearMarkers()
    const el = document.createElement('div')
    el.className = 'marker-pin'
    // apply selected marker color
    el.style.backgroundColor = markerColor
    const pulse = document.createElement('span')
    pulse.className = 'pin-pulse'
    pulse.style.boxShadow = `0 0 0 6px ${markerColor}33` // subtle pulse using color
    el.appendChild(pulse)
    const marker = new mapboxgl.Marker(el).setLngLat([lng, lat]).addTo(map)
    markersRef.current.push(marker)
    return marker
  }, [clearMarkers, markerColor])

  // local fallback generator for AI content when OpenAI key not provided
  const localFallback = useCallback((placeName, lat, lng, modeName) => {
    const name = placeName || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    if (modeName === 'facts') {
      return `**${name}**\n\n- Type: place\n- Coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}\n- Note: local fallback facts are limited.`
    }
    if (modeName === 'story') {
      return `**A Short Tale — ${name}**\n\nAt dusk in ${name}, the horizon folded like paper and small lights led a stranger to an old harbor. They found a single wooden boat with a name in a language no one spoke anymore.`
    }
    if (modeName === 'travel') {
      return `**Travel Tips — ${name}**\n\nHighlights: wander the older quarters, taste street food near the market. Suggested stay: 2-3 days. Safety: standard urban caution.`
    }
    // lore
    return `**Lore — ${name}**\n\nOld voices say the hills around ${name} keep a ledger of promises — if you whisper, the wind might repeat them.`
  }, [])

  // top-level AI fetcher (available to all handlers). Uses OpenAI if VITE_OPENAI_KEY is set, otherwise uses localFallback.
  const fetchAIForPlace = useCallback(async (placeName, lat, lng) => {
    setAiContent(null)
    setLoadingAI(true)
    const prompt = `You are a helpful travel + culture assistant. The user selected ${placeName} at coordinates ${lat.toFixed(6)}, ${lng.toFixed(6)}.\nMode: ${mode}\nProvide useful information depending on the mode. If mode is facts: list key facts and short bullet points (population if known, type, coordinates, short geography). If mode is story: write a short evocative micro-story (2-3 sentences). If mode is travel: provide quick travel tips, suggested itinerary highlights, and safety tips. If mode is lore: invent a short myth or legend rooted in the place's feel. Keep the tone cinematic and concise.`

    if (openaiKey) {
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a helpful travel and cultural assistant.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 500,
            temperature: 0.9
          })
        })
        const j = await resp.json()
        const text = j?.choices?.[0]?.message?.content || 'No response.'
        setAiContent({ title: placeName, body: text })
      } catch {
        setAiContent({ title: placeName, body: 'AI lookup failed. Try again later.' })
      } finally {
        setLoadingAI(false)
      }
    } else {
      // fallback
      setTimeout(() => {
        const body = localFallback(placeName, lat, lng, mode)
        setAiContent({ title: placeName, body })
        setLoadingAI(false)
      }, 450)
    }
  }, [localFallback, mode, openaiKey])

  // keep a ref to latest fetchAIForPlace so map click handler inside the init effect can call it
  const fetchAIRef = useRef(fetchAIForPlace)
  useEffect(() => {
    fetchAIRef.current = fetchAIForPlace
  }, [fetchAIForPlace])

  const addMarkerRef = useRef(addMarker)
  useEffect(() => {
    addMarkerRef.current = addMarker
  }, [addMarker])

  const markersEnabledRef = useRef(markersEnabled)
  useEffect(() => {
    markersEnabledRef.current = markersEnabled
  }, [markersEnabled])

  useEffect(() => {
    if (!TOKEN) return
    if (mapRef.current) return // already initialized

    mapboxgl.accessToken = TOKEN
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v10', // non-satellite
      projection: 'globe',
      center: [0, 20],
      zoom: 1.2,
      interactive: true
    })

    mapRef.current = map

    map.on('style.load', () => {
      // atmosphere / fog for depth
      try {
        map.setFog({})
      } catch {
        // ignore if setFog not supported
      }
    })

    // let users drag/rotate
    try {
      map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()
    } catch {
      // ignore
    }

    // removed inner fetchAIForPlace; using top-level fetchAIForPlace (moved outside useEffect)

    // on click: place a pulsing marker, reverse-geocode, and open AI panel
    const onMapClick = async (e) => {
  // only place markers / open panel when markers are enabled
  if (!markersEnabledRef.current) return
      const lng = e.lngLat.lng
      const lat = e.lngLat.lat
        // add this marker (clears previous markers) using addMarkerRef
        addMarkerRef.current(lng, lat)

      // reverse geocode to get a human-friendly name
      let placeName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      try {
        const q = encodeURIComponent(`${lng},${lat}`)
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${TOKEN}&limit=1`
        const r = await fetch(url)
        const data = await r.json()
        if (data && data.features && data.features[0]) {
          placeName = data.features[0].place_name
        }
      } catch (e) {
        void e
      }

      // open panel and ask AI for content
      setPanelOpen(true)
      setAiContent(null)
      setLoadingAI(true)
      setLastClick({ lat, lng, placeName })

        // call the latest fetch function via ref to avoid reinitializing the map effect
        fetchAIRef.current && fetchAIRef.current(placeName, lat, lng)
    }

  map.on('click', onMapClick)

    return () => {
      map.off('click', onMapClick)
      if (mapRef.current) {
        // clear any markers and remove map (use ref to avoid deps)
        clearMarkersRef.current && clearMarkersRef.current()
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Export composed image: map canvas + legends + marker overlays
  const exportImage = async () => {
    const map = mapRef.current
    if (!map) return
    try {
      const baseDataUrl = map.getCanvas().toDataURL('image/png')
      const img = await new Promise((res) => { const i=new Image(); i.onload=()=>res(i); i.src=baseDataUrl })
      const w = img.width
      const h = img.height
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)

      // draw markers from markersRef
      markersRef.current.forEach((m) => {
        try {
          const ll = m.getLngLat()
          const p = map.project([ll.lng, ll.lat])
          // draw circle
          ctx.beginPath()
          ctx.fillStyle = markerColor
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        } catch (e) { void e }
      })

      // draw legend markers as well
      Object.values(legendMarkersRef.current || {}).forEach((m) => {
        try {
          const ll = m.getLngLat()
          const p = map.project([ll.lng, ll.lat])
          const el = m.getElement()
          // try to compute color from element style
          const color = (el && (el.style && el.style.backgroundColor)) || '#ff5b5b'
          ctx.beginPath()
          ctx.fillStyle = color
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        } catch (e) { void e }
      })

      // draw legend at bottom-right
      const padding = 20
      const legendWidth = 260
      const legendHeight = legendItems.length * 28 + 20
      const lx = w - legendWidth - padding
      const ly = h - legendHeight - padding
      // background
      ctx.fillStyle = 'rgba(6,16,37,0.75)'
      ctx.fillRect(lx, ly, legendWidth, legendHeight)
      // items
      ctx.font = '16px sans-serif'
      ctx.fillStyle = '#e6eef8'
      legendItems.forEach((it, idx) => {
        const y = ly + 18 + idx * 28
        // color box
        ctx.fillStyle = it.color
        ctx.fillRect(lx + 10, y - 12, 16, 16)
        // text
        ctx.fillStyle = '#e6eef8'
        ctx.fillText(it.label, lx + 36, y)
      })

      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = 'globe-infographic.png'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      console.error('Export failed', err)
    }
  }

  // Drawing/sketch state
  const [drawing, setDrawing] = useState(false)
  const drawCoordsRef = useRef([]) // array of [lng, lat]
  const [drawItems, setDrawItems] = useState([]) // {id, color, label}
  const [activeDrawId, setActiveDrawId] = useState(null)

  const startDrawing = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    // create a new draw item and associated source+layer
    const id = Date.now()
    const color = markerColor || '#ff5b5b'
    const label = `Sketch ${drawItems.length + 1}`
    const srcId = `infographic-draw-${id}`
    const layerId = `infographic-draw-${id}-line`
    try {
      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: layerId,
        type: 'line',
        source: srcId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color, 'line-width': 3 }
      })
    } catch (e) {
      // ignore if layer/source already exists
      void e
    }
    // register draw item and activate it
    setDrawItems((s) => [...s, { id, color, label }])
    drawCoordsRef.current = []
    setActiveDrawId(id)
    setDrawing(true)

    // disable globe movement while drawing
    try {
      map.dragPan.disable()
      map.dragRotate.disable()
      map.doubleClickZoom.disable()
      map.scrollZoom.disable()
      if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) map.touchZoomRotate.disableRotation()
    } catch (e) { void e }
  }, [markerColor, drawItems.length])

  const stopDrawing = useCallback(() => {
    const map = mapRef.current
    setDrawing(false)
    setActiveDrawId(null)
    // re-enable globe movement
    if (map) {
      try {
        map.dragPan.enable()
        map.dragRotate.enable()
        map.doubleClickZoom.enable()
        map.scrollZoom.enable()
        if (map.touchZoomRotate && map.touchZoomRotate.enableRotation) map.touchZoomRotate.enableRotation()
      } catch (e) { void e }
    }
  }, [])

  const clearDrawing = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    if (!activeDrawId) return
    drawCoordsRef.current = []
    const srcId = `infographic-draw-${activeDrawId}`
    try {
      const src = map.getSource(srcId)
      if (src && src.setData) src.setData({ type: 'FeatureCollection', features: [] })
    } catch (e) { void e }
  }, [activeDrawId])

  // remove a drawing layer/item completely
  const removeDrawItem = useCallback((id) => {
    const map = mapRef.current
    const srcId = `infographic-draw-${id}`
    const layerId = `infographic-draw-${id}-line`
    try {
      if (map && map.getLayer && map.getLayer(layerId)) map.removeLayer(layerId)
    } catch (e) { void e }
    try {
      if (map && map.getSource && map.getSource(srcId)) map.removeSource(srcId)
    } catch (e) { void e }
    setDrawItems((s) => s.filter((d) => d.id !== id))
    if (activeDrawId === id) {
      setActiveDrawId(null)
      setDrawing(false)
      drawCoordsRef.current = []
      // re-enable interactions
      try {
        if (map) {
          map.dragPan.enable()
          map.dragRotate.enable()
          map.doubleClickZoom.enable()
          map.scrollZoom.enable()
          if (map.touchZoomRotate && map.touchZoomRotate.enableRotation) map.touchZoomRotate.enableRotation()
        }
      } catch (e) { void e }
    }
  }, [activeDrawId])

  // remove all draw items and their layers/sources
  const removeAllDrawings = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    // remove layers and sources for each draw item
    try {
      drawItems.forEach((d) => {
        const srcId = `infographic-draw-${d.id}`
        const layerId = `infographic-draw-${d.id}-line`
        try { if (map.getLayer && map.getLayer(layerId)) map.removeLayer(layerId) } catch (e) { void e }
        try { if (map.getSource && map.getSource(srcId)) map.removeSource(srcId) } catch (e) { void e }
      })
    } catch (e) { void e }
    setDrawItems([])
    setActiveDrawId(null)
    setDrawing(false)
    drawCoordsRef.current = []
    // re-enable interactions
    try {
      map.dragPan.enable()
      map.dragRotate.enable()
      map.doubleClickZoom.enable()
      map.scrollZoom.enable()
      if (map.touchZoomRotate && map.touchZoomRotate.enableRotation) map.touchZoomRotate.enableRotation()
    } catch (e) { void e }
  }, [drawItems])

  const updateDrawItemColor = useCallback((id, color) => {
    const map = mapRef.current
    setDrawItems((s) => s.map((d) => (d.id === id ? { ...d, color } : d)))
    try {
      const layerId = `infographic-draw-${id}-line`
      if (map && map.getLayer && map.getLayer(layerId)) map.setPaintProperty(layerId, 'line-color', color)
    } catch (e) { void e }
  }, [])

  // enter edit mode for an existing draw: load its coordinates and enable drawing
  const editDrawItem = useCallback((id) => {
    const map = mapRef.current
    if (!map) return
    const srcId = `infographic-draw-${id}`
    try {
      const src = map.getSource(srcId)
      let coords = []
      if (src && src._data && src._data.features && src._data.features[0] && src._data.features[0].geometry && src._data.features[0].geometry.coordinates) {
        coords = src._data.features[0].geometry.coordinates.slice()
      }
      drawCoordsRef.current = coords || []
    } catch (e) {
      drawCoordsRef.current = []
    }
    setActiveDrawId(id)
    setDrawing(true)
    // disable globe movement while editing
    try {
      map.dragPan.disable()
      map.dragRotate.disable()
      map.doubleClickZoom.disable()
      map.scrollZoom.disable()
      if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) map.touchZoomRotate.disableRotation()
    } catch (e) { void e }
  }, [])

  // map click handler for drawing: when drawing is active, add point and update source
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // freehand drawing: mousedown + mousemove + mouseup (also touch)
    const isStroke = { value: false }

    const startStroke = (lng, lat) => {
      if (!drawing || !activeDrawId) return
      isStroke.value = true
      // start a new stroke by pushing the first point
      drawCoordsRef.current.push([lng, lat])
      const data = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: drawCoordsRef.current } }] }
      try {
        const srcId = `infographic-draw-${activeDrawId}`
        const src = map.getSource(srcId)
        if (src && src.setData) src.setData(data)
      } catch (err) { void err }
    }

    const moveStroke = (lng, lat) => {
      if (!drawing || !activeDrawId || !isStroke.value) return
      drawCoordsRef.current.push([lng, lat])
      const data = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: drawCoordsRef.current } }] }
      try {
        const srcId = `infographic-draw-${activeDrawId}`
        const src = map.getSource(srcId)
        if (src && src.setData) src.setData(data)
      } catch (err) { void err }
    }

    const endStroke = () => {
      isStroke.value = false
    }

    const onMouseDown = (e) => {
      // left button only
      if (e && e.originalEvent && e.originalEvent.button !== 0) return
      const lng = e.lngLat.lng
      const lat = e.lngLat.lat
      startStroke(lng, lat)
    }
    const onMouseMove = (e) => {
      if (!isStroke.value) return
      const lng = e.lngLat.lng
      const lat = e.lngLat.lat
      moveStroke(lng, lat)
    }
    const onMouseUp = () => endStroke()

    // touch support
    const onTouchStart = (e) => {
      if (!e.lngLat) return
      startStroke(e.lngLat.lng, e.lngLat.lat)
    }
    const onTouchMove = (e) => {
      if (!e.lngLat) return
      moveStroke(e.lngLat.lng, e.lngLat.lat)
    }
    const onTouchEnd = () => endStroke()

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    map.on('touchstart', onTouchStart)
    map.on('touchmove', onTouchMove)
    map.on('touchend', onTouchEnd)

    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      map.off('touchstart', onTouchStart)
      map.off('touchmove', onTouchMove)
      map.off('touchend', onTouchEnd)
    }
  }, [drawing, activeDrawId])

  // keep line color in sync with markerColor
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    try {
      // update all draw layers to match markerColor for active drawing only
      drawItems.forEach((d) => {
        const layerId = `infographic-draw-${d.id}-line`
        if (map.getLayer && map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'line-color', d.color || markerColor)
        }
      })
    } catch (e) { void e }
  }, [markerColor, drawItems])

  // when mode changes and there's a last clicked location open, re-fetch AI for new mode
  useEffect(() => {
    if (panelOpen && lastClick) {
      fetchAIForPlace(lastClick.placeName, lastClick.lat, lastClick.lng)
    }
  }, [mode, panelOpen, lastClick, fetchAIForPlace])

  // helper: fetch suggestions from Mapbox Geocoding API (autocomplete)
  const fetchSuggestions = (text) => {
    if (!text || !TOKEN) {
      setSuggestions([])
      return
    }
    setLoadingSuggest(true)
    const q = encodeURIComponent(text)
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${TOKEN}&autocomplete=true&limit=6`
    fetch(url)
      .then((r) => r.json())
      .then((data) => setSuggestions((data && data.features) || []))
      .catch(() => setSuggestions([]))
      .finally(() => setLoadingSuggest(false))
  }

  // clear the search input and suggestions
  const clearSearch = () => {
    setQuery('')
    setSuggestions([])
    setActiveIndex(-1)
  }

  // debounce query changes
  useEffect(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (!query) {
      setSuggestions([])
      setActiveIndex(-1)
      return
    }
    suggestTimer.current = setTimeout(() => fetchSuggestions(query), 250)
    return () => clearTimeout(suggestTimer.current)
  }, [query])

  const onSelectSuggestion = (feature) => {
    setSelected(feature)
    setSuggestions([])
    setQuery(feature.place_name)
    const map = mapRef.current
    if (!map) return
    const [lng, lat] = feature.center
    // pick a zoom based on place_type; countries -> lower zoom
    const isCountry = (feature.place_type || []).includes('country')
    const zoom = isCountry ? 4 : 8
    map.flyTo({
      center: [lng, lat],
      zoom,
      pitch: 30,
      bearing: 0,
      duration: 1700,
      essential: true,
      easing: (t) => t * (2 - t)
    })
    // only add a marker if markers are enabled; do NOT open the side panel for searches
    if (markersEnabled) addMarker(lng, lat)
  }

  // content generators (local/simple)
  const generateContent = () => {
    if (!selected) return { title: 'No place selected', body: 'Search for a city or country to see content.' }
    const name = selected.text || selected.place_name
    const region = selected.context ? selected.context.map((c) => c.text).join(', ') : ''
    if (mode === 'facts') {
      const coords = selected.center ? `${selected.center[1].toFixed(4)}, ${selected.center[0].toFixed(4)}` : '—'
      return {
        title: selected.place_name,
        body: [
          `Type: ${selected.place_type?.join(', ') || '—'}`,
          `Coordinates: ${coords}`,
          region ? `Context: ${region}` : null
        ].filter(Boolean).join('\n')
      }
    }
    const seed = `${name}-${mode}`
    const rnd = (n) => Math.abs([...seed].reduce((s, c) => s + c.charCodeAt(0), 0) + n) % 6
    if (mode === 'story') {
      return {
        title: `A Short Tale — ${name}`,
        body: `At dusk in ${name}, a wandering soul listened to the tide of light. Over ${1 + rnd(1)} nights they followed a trail of lanterns and found a small secret the locals kept: humility in the face of vast horizons.`
      }
    }
    if (mode === 'travel') {
      return {
        title: `Travel Tips — ${name}`,
        body: `Highlights: explore the historic quarter, sample street markets, and seek sunrise views. Suggested stay: ${2 + rnd(2)} days. Local tip: try the seasonal specialty and look for small guided walks.`
      }
    }
    // lore
    return {
      title: `Lore — ${name}`,
      body: `Old tales say ${name} once hosted a council of winds. If you stand very still at the right ridge, the stones will sing the names of long-forgotten travelers.`
    }
  }

  const content = generateContent()

  return (
    <>
      <div id="map" className="map-full" ref={mapContainer} />

      {/* UI overlay */}
      <div className="ui-overlay">
        <div className="search-card">
          <div className="search-input-wrap">
            <input
              className="search-input"
              placeholder="Search city or country — e.g. Tokyo, Brazil"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(-1)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  setActiveIndex((i) => Math.min((suggestions.length || 0) - 1, i + 1))
                  e.preventDefault()
                } else if (e.key === 'ArrowUp') {
                  setActiveIndex((i) => Math.max(0, i - 1))
                  e.preventDefault()
                } else if (e.key === 'Enter') {
                  const sel = suggestions[activeIndex] || suggestions[0]
                  if (sel) onSelectSuggestion(sel)
                }
              }}
            />
            <button className="clear-btn" onClick={clearSearch} aria-label="Clear search">✕</button>
            <button className="search-btn" onClick={() => fetchSuggestions(query)} aria-label="Search">
              {loadingSuggest ? '...' : 'Search'}
            </button>
          </div>

          <div className="controls-row">
            <div className="marker-toggle">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={markersEnabled}
                  onChange={(e) => setMarkersEnabled(e.target.checked)}
                />
                <span className="toggle-ui" />
                <span className="toggle-text">Markers</span>
              </label>
            </div>

            <div className="infographics-toggle">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={infographicsOpen}
                  onChange={(e) => setInfographicsOpen(e.target.checked)}
                />
                <span className="toggle-ui" />
                <span className="toggle-text">Infographics</span>
              </label>
            </div>
          </div>

          {suggestions && suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((s, idx) => (
                <li
                  key={s.id}
                  className={idx === activeIndex ? 'active' : ''}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => onSelectSuggestion(s)}
                >
                  <div className="s-place">{s.place_name}</div>
                  <div className="s-type">{(s.place_type || []).join(', ')}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

  {/* Combined side panel: mode switcher + AI/content. Scrollable and constrained to viewport. */}
        <aside className={`side-panel ${panelOpen ? 'open' : ''}`} role="complementary" aria-hidden={!panelOpen}>
          <div className="side-panel-inner">
              <div className="side-header">
              <div className="side-modes" role="tablist" aria-label="Modes">
                <button className={mode === 'facts' ? 'active' : ''} onClick={() => setMode('facts')}>Facts</button>
                <button className={mode === 'story' ? 'active' : ''} onClick={() => setMode('story')}>Story</button>
                <button className={mode === 'travel' ? 'active' : ''} onClick={() => setMode('travel')}>Travel</button>
                <button className={mode === 'lore' ? 'active' : ''} onClick={() => setMode('lore')}>Lore</button>
              </div>
              <button
                className="side-close"
                onClick={() => {
                  setPanelOpen(false)
                  clearMarkers()
                  setSelected(null)
                  setLastClick(null)
                  setAiContent(null)
                }}
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>

            <div className="side-content">
              <header className="side-title">
                <h3>{aiContent?.title || (selected ? (selected.place_name || selected.text) : 'Explore the globe')}</h3>
              </header>

              <div className="side-body">
                {loadingAI ? (
                  <div className="ai-loading">Thinking…</div>
                ) : (
                  <>
                    {/* Render Markdown from AI or fallback content, sanitized */}
                    <div
                      className="ai-text"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(aiContent?.body || content.body || '') }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Infographics panel: customize legends, marker color, and export image */}
        <aside className={`infographics-panel ${infographicsOpen ? 'open' : ''}`} aria-hidden={!infographicsOpen}>
          <div className="infographics-inner">
            <div className="infographics-header">
              <h4>Infographics</h4>
              <button className="side-close" onClick={() => setInfographicsOpen(false)}>✕</button>
            </div>

            <div className="infographics-body">
              <div className="infographics-tabs">
                <button
                  className={infographicsTab === 'markers' ? 'active' : ''}
                  onClick={() => {
                    // if a drawing is currently open, finish it before switching to markers
                    if (drawing) stopDrawing()
                    setInfographicsTab('markers')
                  }}
                >
                  📍 Markers
                </button>
                <button
                  className={infographicsTab === 'drawings' ? 'active' : ''}
                  onClick={() => setInfographicsTab('drawings')}
                >
                  ✏️ Drawings
                </button>
              </div>

              {infographicsTab === 'markers' && (
                <div className="infographics-section">
                  <div className="field">
                    <label>Marker color</label>
                    <input type="color" value={markerColor} onChange={(e) => setMarkerColor(e.target.value)} />
                  </div>

                  <div className="legend-list">
                    <div className="legend-header">
                      <strong>Legend items</strong>
                      <button onClick={addLegendItem}>+ Add</button>
                    </div>
                    {legendItems.map((it) => (
                      <div key={it.id} className="legend-item">
                        <input type="color" value={it.color} onChange={(e) => updateLegendItem(it.id, { color: e.target.value })} />
                        <input className="legend-label" value={it.label} onChange={(e) => updateLegendItem(it.id, { label: e.target.value })} />
                        <button className="remove" onClick={() => removeLegendItem(it.id)} aria-label="Remove legend item">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {infographicsTab === 'drawings' && (
                <div className="infographics-section">
                  <div className="legend-list">
                    <div className="legend-header">
                      <strong>Drawings</strong>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { if (drawing) stopDrawing(); else startDrawing(); }}>{drawing ? 'Finish' : 'New Draw'}</button>
                        <button onClick={() => { removeAllDrawings() }}>Clear</button>
                      </div>
                    </div>
                    {drawItems.map((d) => (
                      <div key={d.id} className="legend-item">
                        <input type="color" value={d.color} onChange={(e) => updateDrawItemColor(d.id, e.target.value)} />
                        <input className="legend-label" value={d.label} onChange={(e) => setDrawItems((s)=>s.map(it=>it.id===d.id?{...it,label:e.target.value}:it))} />
                          <button className="remove" onClick={() => removeDrawItem(d.id)} aria-label="Remove drawing">
                            <Trash2 size={16} />
                          </button>
                          <button className="remove" onClick={() => editDrawItem(d.id)} aria-label="Edit drawing">
                            <Edit3 size={16} />
                          </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* actions removed as requested (Export / Draw / Clear buttons removed from footer) */}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}
