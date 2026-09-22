import {
  applyCoordsToSelectionWithCursor,
  collectVisibleMapGeometry,
  locateSelectionGeometry
} from "./map-text.js";
import { parseMapCenterParameter } from "./url.js";

const DEFAULT_CENTER = [30, 0];
const DEFAULT_ZOOM = 2;
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_IMAGERY_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org">OpenStreetMap contributors</a>';
const ESRI_ATTRIBUTION = "Imagery © Esri";
const DEFAULT_BASE_LAYER = {
  name: "OpenStreetMap",
  tileUrl: OSM_TILE_URL,
  attribution: OSM_ATTRIBUTION
};

export function buildMapAreaReference(lat, lon, zoom) {
  return `map=${Math.round(zoom)}/${lat}/${lon}`;
}

export function computeVisibleGeometryBbox(geometry) {
  let bbox = null;

  function extend(coords) {
    if (!Array.isArray(coords) || coords.length < 2) {
      return;
    }

    const [lat, lon] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    if (!bbox) {
      bbox = { minLat: lat, minLon: lon, maxLat: lat, maxLon: lon };
      return;
    }

    bbox.minLat = Math.min(bbox.minLat, lat);
    bbox.minLon = Math.min(bbox.minLon, lon);
    bbox.maxLat = Math.max(bbox.maxLat, lat);
    bbox.maxLon = Math.max(bbox.maxLon, lon);
  }

  for (const point of geometry.points ?? []) {
    extend(point.coords);
  }

  for (const segment of geometry.segments ?? []) {
    for (const coords of segment) {
      extend(coords);
    }
  }

  return bbox;
}

function getLeaflet() {
  return window.L;
}

function createGeometryBoundsControl(leaflet, onClick) {
  let button = null;

  const Control = leaflet.Control.extend({
    options: {
      position: "topleft"
    },
    onAdd() {
      const container = leaflet.DomUtil.create("div", "leaflet-bar");
      button = leaflet.DomUtil.create("a", "leaflet-control-zoom-to-geometry leaflet-disabled", container);
      button.href = "#";
      button.title = "Zoom to visible geometry";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Zoom to visible geometry");
      button.setAttribute("aria-disabled", "true");
      button.innerHTML =
        '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">\n' +
        '  <path d="M3 7V3H7" stroke-width="2" stroke-linecap="round"/>\n' +
        '  <path d="M17 3H21V7" stroke-width="2" stroke-linecap="round"/>\n' +
        '  <path d="M21 17V21H17" stroke-width="2" stroke-linecap="round"/>\n' +
        '  <path d="M7 21H3V17" stroke-width="2" stroke-linecap="round"/>\n' +
        "</svg>"

      leaflet.DomEvent.disableClickPropagation(container);
      leaflet.DomEvent.disableScrollPropagation(container);
      leaflet.DomEvent.on(button, "click", (event) => {
        leaflet.DomEvent.stop(event);
        if (button.classList.contains("leaflet-disabled")) {
          return;
        }
        onClick();
      });

      return container;
    }
  });

  return {
    addTo(map) {
      const control = new Control();
      control.addTo(map);
      return this;
    },
    setDisabled(disabled) {
      if (!button) {
        return;
      }

      button.classList.toggle("leaflet-disabled", disabled);
      button.setAttribute("aria-disabled", disabled ? "true" : "false");
    }
  };
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
  defaultBaseLayer = DEFAULT_BASE_LAYER,
  onDownloadArea
}) {
  const leaflet = getLeaflet();
  if (!leaflet || !mapElement) {
    return {
      refreshFromText() {},
      setDefaultBaseLayer() {},
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

  const esriImageryLayer = leaflet.tileLayer(ESRI_IMAGERY_TILE_URL, {
    attribution: ESRI_ATTRIBUTION
  });
  let activeBaseLayer = null;
  let baseLayerControl = null;

  function createBaseLayer(baseLayer) {
    return leaflet.tileLayer(baseLayer.tileUrl, {
      attribution: baseLayer.attribution
    });
  }

  function setDefaultBaseLayer(baseLayer = DEFAULT_BASE_LAYER) {
    if (activeBaseLayer) {
      map.removeLayer(activeBaseLayer);
    }
    if (baseLayerControl) {
      map.removeControl(baseLayerControl);
    }

    activeBaseLayer = createBaseLayer(baseLayer).addTo(map);
    const baseLayers = {
      [baseLayer.name]: activeBaseLayer,
      "ESRI Imagery": esriImageryLayer
    };
    if (baseLayer.tileUrl !== OSM_TILE_URL) {
      baseLayers.OpenStreetMap = createBaseLayer(DEFAULT_BASE_LAYER);
    }

    baseLayerControl = leaflet.control.layers(baseLayers, {}, { collapsed: true }).addTo(map);
  }

  setDefaultBaseLayer(defaultBaseLayer);
  map.on("baselayerchange", ({ layer }) => {
    activeBaseLayer = layer;
  });
  leaflet.control.attribution({ prefix: null }).addTo(map);

  const marker = leaflet.marker(map.getCenter(), { draggable: true }).addTo(map);
  const objectWays = leaflet.layerGroup().addTo(map);
  const objectNodes = leaflet.layerGroup().addTo(map);
  const selectionWays = leaflet.layerGroup().addTo(map);
  const splitPreviewLayer = leaflet.layerGroup().addTo(map);
  const splitPreviewState = {
    view: null
  };
  let visibleGeometryBbox = null;
  let preserveMapPositionOnNextSelection = false;

  const geometryBoundsControl = createGeometryBoundsControl(leaflet, () => {
    if (!visibleGeometryBbox) {
      return;
    }

    const bounds = leaflet.latLngBounds(
      [visibleGeometryBbox.minLat, visibleGeometryBbox.minLon],
      [visibleGeometryBbox.maxLat, visibleGeometryBbox.maxLon]
    );
    map.fitBounds(bounds.pad(0.08), { maxZoom: 18 });
  }).addTo(map);

  function updateGeometryBoundsControl() {
    geometryBoundsControl.setDisabled(!visibleGeometryBbox);
  }

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
    visibleGeometryBbox = computeVisibleGeometryBbox(geometry);
    updateGeometryBoundsControl();

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

  function drawSelection(highlight = false, centerMap = true) {
    selectionWays.clearLayers();
    const geometry = locateSelectionGeometry(textarea.value, textarea.selectionStart, undefined, highlight);
    if (centerMap && geometry.center && !preserveMapPositionOnNextSelection) {
      setCenter(geometry.center);
    }
    preserveMapPositionOnNextSelection = false;
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

    const colors = ["#d9480f", "#5f3dc4", "#2f9e44", "#0b7285"];

    // Fit first. Creating SVG polygons at the old zoom and then changing the
    // view can leave Leaflet with a path projected for the previous renderer
    // bounds.
    const previewBounds = validBboxes.map((bbox) => (
      leaflet.latLngBounds(
        [bbox.minLat, bbox.minLon],
        [bbox.maxLat, bbox.maxLon]
      )
    ));
    let unionBounds = null;
    for (const bounds of previewBounds) {
      // LatLngBounds.extend() mutates its receiver. Do not use a group's own
      // bounds as the accumulator, otherwise the first preview becomes the
      // union of every group.
      unionBounds = unionBounds
        ? unionBounds.extend(bounds)
        : leaflet.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
    }

    if (unionBounds) {
      map.fitBounds(unionBounds.pad(0.08), { animate: false });
      marker.setLatLng(map.getCenter());
      updateCoords();
    }

    previewBounds.forEach((bounds, index) => {
      const southWestPoint = map.latLngToContainerPoint(bounds.getSouthWest());
      const northEastPoint = map.latLngToContainerPoint(bounds.getNorthEast());
      const widthPixels = Math.abs(northEastPoint.x - southWestPoint.x);
      const heightPixels = Math.abs(northEastPoint.y - southWestPoint.y);
      const minimumBboxSizePixels = 4;
      const style = {
        color: colors[index % colors.length],
        weight: 2,
        fillColor: colors[index % colors.length],
        fillOpacity: 0.08,
        dashArray: "5 4",
        interactive: false,
        // Split previews have at most ten simple rectangles. Keep every
        // corner while Leaflet recalculates their pixel geometry after fitBounds.
        noClip: true,
        smoothFactor: 0
      };
      // Coordinates in the summary are rounded. A tiny non-zero bbox can be
      // smaller than one screen pixel at the fitted zoom and becomes a broken
      // SVG polygon, so represent it as the geometry the user can actually see.
      const isPoint = widthPixels < minimumBboxSizePixels && heightPixels < minimumBboxSizePixels;
      const isLine = !isPoint && (widthPixels < minimumBboxSizePixels || heightPixels < minimumBboxSizePixels);

      if (isPoint) {
        splitPreviewLayer.addLayer(leaflet.circleMarker(bounds.getCenter(), {
          ...style,
          radius: 6,
          fillOpacity: 0.35
        }));
      } else if (isLine) {
        splitPreviewLayer.addLayer(leaflet.polyline([
          bounds.getSouthWest(),
          bounds.getNorthEast()
        ], style));
      } else {
        splitPreviewLayer.addLayer(leaflet.rectangle(bounds, style));
      }
    });
  }

  map.on("moveend", checkZoom);
  map.on("dragstart", () => {
    preserveMapPositionOnNextSelection = true;
  });
  marker.on("dragstart", () => {
    preserveMapPositionOnNextSelection = true;
  });
  marker.on("dragend", () => {
    map.panTo(marker.getLatLng());
  });
  marker.on("move dragend", updateCoords);
  map.on("drag zoomend", () => {
    marker.setLatLng(map.getCenter());
  });

  coord2textButton.disabled = false;
  coord2textButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  function applyCoordsFromInput() {
    const insertedCenter = parseMapCenterParameter(coordsInput.value);
    const updated = applyCoordsToSelectionWithCursor(
      textarea.value,
      textarea.selectionStart,
      coordsInput.value
    );
    textarea.value = updated.text;
    textarea.setSelectionRange(updated.selectionStart, updated.selectionStart);
    drawLoadedObjects();
    if (insertedCenter) {
      setCenter([insertedCenter.lat, insertedCenter.lon]);
    }
    drawSelection(false, false);
  }

  coord2textButton.addEventListener("click", () => {
    applyCoordsFromInput();
  });
  coordsInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    applyCoordsFromInput();
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
  textarea.addEventListener("keyup", (event) => {
    if (event.key?.startsWith("Arrow")) {
      return;
    }

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
    setDefaultBaseLayer(baseLayer) {
      setDefaultBaseLayer(baseLayer);
    },
    setView(lat, lon, zoom) {
      setMapView(lat, lon, zoom);
    },
    getZoom() {
      return map.getZoom();
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
