import {
  applyCoordsToSelection,
  collectVisibleMapGeometry,
  locateSelectionGeometry
} from "./map-text.js";

const DEFAULT_CENTER = [30, 0];
const DEFAULT_ZOOM = 2;
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_IMAGERY_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const OSM_ATTRIBUTION = 'Map © <a href="https://www.openstreetmap.org">OpenStreetMap contributors</a>';
const ESRI_ATTRIBUTION = "Tiles © Esri";

export function buildMapAreaReference(lat, lon, zoom) {
  return `map=${Math.round(zoom)}/${lat}/${lon}`;
}

function getLeaflet() {
  return window.L;
}

function createRestoreViewMixin(leaflet) {
  return {
    restoreView() {
      const storage = window.localStorage ?? {};

      if (!this.__initRestore) {
        this.on("moveend", function onMoveEnd() {
          if (!this._loaded) {
            return;
          }

          storage.mapView = JSON.stringify({
            lat: this.getCenter().lat,
            lng: this.getCenter().lng,
            zoom: this.getZoom()
          });
        }, this);
        this.__initRestore = true;
      }

      const view = storage.mapView;
      try {
        const parsed = JSON.parse(view || "");
        this.setView(leaflet.latLng(parsed.lat, parsed.lng), parsed.zoom, true);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export function initMapEditor({
  mapElement,
  coordsInput,
  centerInput,
  textarea,
  coord2textButton,
  downareaButton,
  urlInput,
  onDownloadArea
}) {
  const leaflet = getLeaflet();
  if (!leaflet || !mapElement) {
    return {
      refreshFromText() {},
      getMapCenterString() {
        return "";
      }
    };
  }

  leaflet.Map.include(createRestoreViewMixin(leaflet));

  mapElement.classList.remove("map-placeholder");
  mapElement.textContent = "";

  const map = leaflet.map(mapElement, { attributionControl: false });
  if (!map.restoreView()) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }

  const osmLayer = leaflet.tileLayer(OSM_TILE_URL, {
    attribution: OSM_ATTRIBUTION
  }).addTo(map);
  const esriImageryLayer = leaflet.tileLayer(ESRI_IMAGERY_TILE_URL, {
    attribution: ESRI_ATTRIBUTION
  });

  leaflet.control.layers(
    {
      OpenStreetMap: osmLayer,
      "ESRI Imagery": esriImageryLayer
    },
    {},
    { collapsed: true }
  ).addTo(map);
  leaflet.control.attribution({ prefix: null }).addTo(map);

  const marker = leaflet.marker(map.getCenter(), { draggable: true }).addTo(map);
  const objectWays = leaflet.layerGroup().addTo(map);
  const objectNodes = leaflet.layerGroup().addTo(map);
  const selectionWays = leaflet.layerGroup().addTo(map);
  const splitPreviewLayer = leaflet.layerGroup().addTo(map);
  const splitPreviewState = {
    view: null
  };

  function checkZoom() {
    downareaButton.disabled = map.getZoom() < 15;
  }

  function getCenter(delimiter) {
    return `${leaflet.Util.formatNum(map.getCenter().lat, 6)}${delimiter}${leaflet.Util.formatNum(map.getCenter().lng, 6)}`;
  }

  function updateCoords() {
    coordsInput.value = getCenter(", ");
    centerInput.value = map.getZoom() < 13 ? "" : getCenter(",");
  }

  function setCenter(latlng) {
    map.panTo(latlng);
    marker.setLatLng(latlng);
  }

  function setMapView(lat, lon, zoom = map.getZoom()) {
    const latlng = leaflet.latLng(lat, lon);
    map.setView(latlng, zoom);
    marker.setLatLng(latlng);
    updateCoords();
    checkZoom();
  }

  function drawLoadedObjects() {
    objectWays.clearLayers();
    objectNodes.clearLayers();

    const geometry = collectVisibleMapGeometry(textarea.value);
    for (const point of geometry.points) {
      objectNodes.addLayer(leaflet.circleMarker(point.coords, {
        radius: point.tagged ? 3 : 1,
        color: "#111",
        weight: 1,
        fillColor: "#111",
        fillOpacity: 1,
        interactive: false
      }));
    }

    for (const segment of geometry.segments) {
      objectWays.addLayer(leaflet.polyline(segment, {
        color: "#111",
        weight: 1,
        opacity: 1,
        interactive: false
      }));
    }
  }

  function drawSelection(highlight = false) {
    selectionWays.clearLayers();
    const geometry = locateSelectionGeometry(textarea.value, textarea.selectionStart, undefined, highlight);
    if (geometry.center) {
      setCenter(geometry.center);
    }
    for (const segment of geometry.segments) {
      selectionWays.addLayer(leaflet.polyline(segment.coords, {
        color: segment.color,
        weight: 3
      }));
    }
  }

  function clearSplitPreview(restoreView = true) {
    splitPreviewLayer.clearLayers();

    if (restoreView && splitPreviewState.view) {
      map.setView(splitPreviewState.view.center, splitPreviewState.view.zoom, { animate: false });
      marker.setLatLng(map.getCenter());
      updateCoords();
      checkZoom();
    }

    splitPreviewState.view = null;
  }

  function renderSplitPreview(groupBboxes) {
    clearSplitPreview(false);

    const validBboxes = groupBboxes.filter((bbox) => bbox);
    if (validBboxes.length === 0) {
      return;
    }

    splitPreviewState.view = {
      center: leaflet.latLng(map.getCenter()),
      zoom: map.getZoom()
    };

    const previewBounds = [];
    const colors = ["#d9480f", "#5f3dc4", "#2f9e44", "#0b7285"];

    validBboxes.forEach((bbox, index) => {
      const bounds = leaflet.latLngBounds(
        [bbox.minLat, bbox.minLon],
        [bbox.maxLat, bbox.maxLon]
      );
      previewBounds.push(bounds);
      splitPreviewLayer.addLayer(leaflet.rectangle(bounds, {
        color: colors[index % colors.length],
        weight: 2,
        fillColor: colors[index % colors.length],
        fillOpacity: 0.08,
        dashArray: "5 4",
        interactive: false
      }));
    });

    const unionBounds = previewBounds.reduce((accumulator, bounds) => (
      accumulator ? accumulator.extend(bounds) : bounds
    ), null);

    if (unionBounds) {
      map.fitBounds(unionBounds.pad(0.08), { animate: false });
      marker.setLatLng(map.getCenter());
      updateCoords();
    }
  }

  map.on("moveend", checkZoom);
  marker.on("dragend", () => {
    map.panTo(marker.getLatLng());
  });
  marker.on("move dragend", updateCoords);
  map.on("drag zoomend", () => {
    marker.setLatLng(map.getCenter());
  });

  coord2textButton.disabled = false;
  coord2textButton.addEventListener("click", () => {
    const updatedText = applyCoordsToSelection(textarea.value, textarea.selectionStart, coordsInput.value);
    const selectionStart = textarea.selectionStart;
    textarea.value = updatedText;
    textarea.setSelectionRange(selectionStart, selectionStart);
    drawLoadedObjects();
    drawSelection();
  });

  downareaButton.addEventListener("click", async () => {
    const reference = buildMapAreaReference(
      leaflet.Util.formatNum(map.getCenter().lat, 6),
      leaflet.Util.formatNum(map.getCenter().lng, 6),
      map.getZoom()
    );
    urlInput.value = reference;
    await onDownloadArea?.(reference);
  });

  textarea.addEventListener("click", () => {
    drawSelection();
  });
  textarea.addEventListener("keyup", () => {
    drawLoadedObjects();
    drawSelection();
  });

  drawLoadedObjects();
  checkZoom();
  updateCoords();

  return {
    refreshFromText() {
      drawLoadedObjects();
      drawSelection();
      updateCoords();
    },
    setView(lat, lon, zoom) {
      setMapView(lat, lon, zoom);
    },
    getMapCenterString() {
      return getCenter(",");
    },
    renderSplitPreview(groupBboxes) {
      renderSplitPreview(groupBboxes);
    },
    clearSplitPreview() {
      clearSplitPreview();
    }
  };
}
