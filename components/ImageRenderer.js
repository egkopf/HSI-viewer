import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { parseSpecificBands, extractPixelSpectrum } from '../utils/parseHyperspectral';
import { parseGeoTIFFBands, extractGeoTIFFPixelSpectrum } from '../utils/parseGeoTIFF';
import { isValidPixelValue } from '../utils/dataValidation';
import { useSharedSpectral } from '../utils/sharedSpectralContent';

const ExportButton = ({ svgRef, fileName = "spectral-profile" }) => {
  const handleExport = () => {
    if (!svgRef.current) return;
    const svgElement = svgRef.current.cloneNode(true);
    svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.svg`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(link);
    }, 100);
  };

  return (
    <button onClick={handleExport} className="text-blue-500 hover:text-blue-700 text-sm mr-2">
      Export
    </button>
  );
};

const ImageRenderer = ({ 
  bandData, 
  metadata, 
  loadedBands, 
  dataFile, 
  enableSharedSpectral = false,
  isMainSpectralDisplay = true
}) => {
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const svgRef = useRef(null);

  // Spectral data state management
  const sharedContext = useSharedSpectral();
  const [localSpectralData, setLocalSpectralData] = useState([]);
  const [localShowSpectral, setLocalShowSpectral] = useState(false);

  const spectralDataArray = enableSharedSpectral ? sharedContext.sharedSpectralData : localSpectralData;
  const showSpectralGraph = enableSharedSpectral ? sharedContext.showSharedSpectralGraph : localShowSpectral;
  const setShowSpectralGraph = enableSharedSpectral ? sharedContext.setShowSharedSpectralGraph : setLocalShowSpectral;

  // Band management
  const [bands, setBands] = useState(() => getInitialBands(loadedBands, metadata));
  const [inputBands, setInputBands] = useState(() => getInitialInputBands(loadedBands, metadata));
  const [currentBandData, setCurrentBandData] = useState(bandData);
  const [currentLoadedBands, setCurrentLoadedBands] = useState(loadedBands);
  const [loadingBands, setLoadingBands] = useState(false);

  // UI state
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [cursorPosition, setCursorPosition] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingName, setEditingName] = useState('');

  // Image enhancement settings
  const [normalizationSettings, setNormalizationSettings] = useState({
    lowerPercentile: 0.01,
    upperPercentile: 0.99,
    gamma: 0.65
  });

  // Initialize bands when metadata changes
  useEffect(() => {
    if (metadata?.defaultBands) {
      const newBands = {
        red: metadata.defaultBands[0],
        green: metadata.defaultBands[1],
        blue: metadata.defaultBands[2]
      };
      setBands(newBands);
      setInputBands({
        red: newBands.red.toString(),
        green: newBands.green.toString(),
        blue: newBands.blue.toString()
      });
    }
  }, [metadata]);

  // Update current data when props change
  useEffect(() => {
    setCurrentBandData(bandData);
    setCurrentLoadedBands(loadedBands);
  }, [bandData, loadedBands]);

  // Clear spectral data when file changes
  useEffect(() => {
    if (enableSharedSpectral) {
      sharedContext.clearAllSpectralData();
    } else {
      setLocalSpectralData([]);
      setLocalShowSpectral(false);
    }
  }, [dataFile]);

  // Load new bands
  const loadNewBands = useCallback(async (newBands) => {
    if (!dataFile || !metadata) return;

    const newBandNumbers = [newBands.red, newBands.green, newBands.blue];

    // Check if already loaded
    if (currentLoadedBands && 
        arraysEqual(currentLoadedBands, newBandNumbers)) {
      return;
    }

    try {
      setLoadingBands(true);
      console.log('Loading new bands:', newBandNumbers);

      const newBandData = metadata.fileType === 'geotiff'
        ? await parseGeoTIFFBands(dataFile, metadata, newBandNumbers)
        : await parseSpecificBands(dataFile, metadata, newBandNumbers);

      setCurrentBandData(newBandData);
      setCurrentLoadedBands(newBandNumbers);
    } catch (error) {
      console.error('Error loading bands:', error);
      alert('Failed to load bands: ' + error.message);
    } finally {
      setLoadingBands(false);
    }
  }, [dataFile, metadata, currentLoadedBands]);

  // Render image to canvas
  useEffect(() => {
    if (!currentBandData || !metadata || !canvasRef.current) return;
    renderImage();
  }, [currentBandData, metadata, bands, normalizationSettings]);

  // Draw pixel overlays
  useEffect(() => {
    if (!overlayCanvasRef.current || !metadata) return;
    drawPixelOverlays();
  }, [spectralDataArray, metadata]);

  // Handle pixel clicks
  const handlePixelClick = useCallback(async (event) => {
    if (!dataFile || !metadata || !canvasRef.current) return;

    const { x, y } = getCanvasCoordinates(event, canvasRef.current);
    if (x < 0 || x >= metadata.samples || y < 0 || y >= metadata.lines) return;

    try {
      console.log(`Extracting spectrum for pixel (${x}, ${y})`);
      
      const pixelSpectrum = metadata.fileType === 'geotiff'
        ? await extractGeoTIFFPixelSpectrum(dataFile, metadata, x, y)
        : await extractPixelSpectrum(dataFile, metadata, x, y);

      const validValues = pixelSpectrum.filter(point => point.value > 0);
      if (validValues.length === 0 || validValues.length < pixelSpectrum.length * 0.1) {
        console.log(`Pixel (${x}, ${y}) has no valid spectral data - ignoring`);
        return;
      }

      const newSpectralData = {
        spectrum: pixelSpectrum,
        position: { x, y },
        color: generateRandomColor(),
        name: `Pixel (${x}, ${y})`,
        imageSource: enableSharedSpectral ? (isMainSpectralDisplay ? 'img 1' : 'img 2') : null,
        metadata: metadata
      };

      if (enableSharedSpectral) {
        sharedContext.addSpectralData(newSpectralData);
      } else {
        setLocalSpectralData(prev => [...prev, newSpectralData]);
        setLocalShowSpectral(true);
      }
    } catch (error) {
      console.error('Error extracting pixel spectrum:', error);
      alert('Failed to extract spectral data: ' + error.message);
    }
  }, [dataFile, metadata, enableSharedSpectral, sharedContext, isMainSpectralDisplay]);

  // Set up canvas event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = async (event) => {
      if (!currentBandData) return;

      const { x, y } = getCanvasCoordinates(event, canvas);
      if (x < 0 || x >= metadata.samples || y < 0 || y >= metadata.lines) return;

      const redValue = currentBandData[0]?.[y]?.[x] || 0;
      const greenValue = currentBandData[1]?.[y]?.[x] || 0;
      const blueValue = currentBandData[2]?.[y]?.[x] || 0;

      if (!isValidPixelValue(redValue, metadata) || 
          !isValidPixelValue(greenValue, metadata) || 
          !isValidPixelValue(blueValue, metadata)) {
        console.log(`Clicked on pixel (${x}, ${y}) with invalid values - ignoring`);
        return;
      }

      await handlePixelClick(event);
    };

    canvas.addEventListener('click', handleClick);
    return () => canvas.removeEventListener('click', handleClick);
  }, [handlePixelClick, currentBandData, metadata]);

  // Handle outside clicks to close spectral graph
  useEffect(() => {
    if (!showSpectralGraph) return;

    const handleOutsideClick = (event) => {
      const isClickOnGraph = event.target.closest('.spectral-graph');
      const isClickOnCanvas = event.target.closest('canvas');

      if (!isClickOnGraph && !isClickOnCanvas) {
        setShowSpectralGraph(false);
      }
    };

    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showSpectralGraph, setShowSpectralGraph]);

  // Band selection form handler
  const handleSubmit = async (e) => {
    e.preventDefault();

    const redBand = parseInt(inputBands.red, 10);
    const greenBand = parseInt(inputBands.green, 10);
    const blueBand = parseInt(inputBands.blue, 10);

    const maxBand = metadata.bands;
    const isValid = [redBand, greenBand, blueBand].every(
      band => !isNaN(band) && band >= 1 && band <= maxBand
    );

    if (isValid) {
      const newBands = { red: redBand, green: greenBand, blue: blueBand };
      setBands(newBands);
      await loadNewBands(newBands);
    } else {
      alert(`Please enter valid band numbers between 1 and ${maxBand}`);
    }
  };

  // Spectral graph component
  const spectralGraph = useMemo(() => {
    if (!isMainSpectralDisplay || !showSpectralGraph || spectralDataArray.length === 0) {
      return null;
    }

    return <SpectralGraph 
      spectralDataArray={spectralDataArray}
      metadata={metadata}
      bands={bands}
      enableSharedSpectral={enableSharedSpectral}
      sharedContext={sharedContext}
      setLocalSpectralData={setLocalSpectralData}
      setLocalShowSpectral={setLocalShowSpectral}
      setShowSpectralGraph={setShowSpectralGraph}
      svgRef={svgRef}
      hoveredPoint={hoveredPoint}
      setHoveredPoint={setHoveredPoint}
      cursorPosition={cursorPosition}
      setCursorPosition={setCursorPosition}
      editingIndex={editingIndex}
      setEditingIndex={setEditingIndex}
      editingName={editingName}
      setEditingName={setEditingName}
    />;
  }, [
    isMainSpectralDisplay, showSpectralGraph, spectralDataArray, metadata, bands,
    enableSharedSpectral, sharedContext, hoveredPoint, cursorPosition, editingIndex, editingName
  ]);

  // Helper functions
  function renderImage() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { samples, lines } = metadata;

    canvas.width = samples;
    canvas.height = lines;

    const imageData = ctx.createImageData(samples, lines);
    const data = imageData.data;

    // Calculate band statistics for normalization
    const bandStats = [0, 1, 2].map(bandIndex => calculateBandStats(bandIndex));

    // Fast pixel processing
    let dataIndex = 0;
    for (let line = 0; line < lines; line++) {
      const isEdgeLine = line === 0 || line === lines - 1;
      const [redLine, greenLine, blueLine] = [
        currentBandData[0][line],
        currentBandData[1][line], 
        currentBandData[2][line]
      ];

      if (!redLine || !greenLine || !blueLine) {
        // Fill with black if line data missing
        for (let sample = 0; sample < samples; sample++) {
          data[dataIndex++] = 0; data[dataIndex++] = 0; data[dataIndex++] = 0; data[dataIndex++] = 255;
        }
        continue;
      }

      for (let sample = 0; sample < samples; sample++) {
        const isEdgePixel = isEdgeLine || sample === 0 || sample === samples - 1;
        
        if (isEdgePixel) {
          data[dataIndex++] = 0; data[dataIndex++] = 0; data[dataIndex++] = 0; data[dataIndex++] = 255;
          continue;
        }

        const [redValue, greenValue, blueValue] = [redLine[sample], greenLine[sample], blueLine[sample]];
        const isInvalid = [redValue, greenValue, blueValue].some(v => !isValidPixelValue(v, metadata));
        
        if (isInvalid) {
          data[dataIndex++] = 0; data[dataIndex++] = 0; data[dataIndex++] = 0; data[dataIndex++] = 255;
        } else {
          data[dataIndex++] = normalizeValue(redValue, bandStats[0]);
          data[dataIndex++] = normalizeValue(greenValue, bandStats[1]);
          data[dataIndex++] = normalizeValue(blueValue, bandStats[2]);
          data[dataIndex++] = 255;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    
    if (overlayCanvasRef.current) {
      overlayCanvasRef.current.width = samples;
      overlayCanvasRef.current.height = lines;
    }
  }

  function calculateBandStats(bandIndex) {
    if (!currentBandData[bandIndex]) return { min: 0, max: 65535 };

    const values = [];
    const { samples, lines } = metadata;
    const skipInterval = 5;

    for (let line = 0; line < lines; line += skipInterval) {
      const lineData = currentBandData[bandIndex][line];
      if (!lineData) continue;
      
      for (let sample = 0; sample < samples; sample += skipInterval) {
        const value = lineData[sample];
        if (value !== undefined && isValidPixelValue(value, metadata)) {
          values.push(value);
        }
      }
    }

    if (values.length === 0) return { min: 0, max: 65535 };

    values.sort((a, b) => a - b);
    const lowerIndex = Math.floor(values.length * normalizationSettings.lowerPercentile);
    const upperIndex = Math.floor(values.length * normalizationSettings.upperPercentile);
    const min = values[lowerIndex] || 0;
    const max = Math.max(values[upperIndex] || 1, min + 1);

    return { min, max, range: max - min };
  }

  function normalizeValue(value, stats) {
    if (!isValidPixelValue(value, metadata) || stats.range <= 0) return 0;
    let normalized = (value - stats.min) / stats.range;
    normalized = Math.max(0, Math.min(1, normalized));
    return Math.floor(Math.pow(normalized, normalizationSettings.gamma) * 255);
  }

  function drawPixelOverlays() {
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas.getContext('2d');
    
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    spectralDataArray.forEach((specData) => {
      const { x, y } = specData.position;
      ctx.fillStyle = specData.color;
      
      // Draw border around selected pixel
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          
          const px = x + dx;
          const py = y + dy;
          
          if (px >= 0 && px < metadata.samples && py >= 0 && py < metadata.lines) {
            ctx.fillRect(px, py, 1, 1);
          }
        }
      }
    });
  }

  const clearAllSpectra = () => {
    if (enableSharedSpectral) {
      sharedContext.clearAllSpectralData();
    } else {
      setLocalSpectralData([]);
      setLocalShowSpectral(false);
    }
  };

  const getWavelengthForBand = useCallback((bandNumber) => {
    if (!metadata?.wavelengthValues || bandNumber < 1 || bandNumber > metadata.bands) {
      return null;
    }
    return metadata.wavelengthValues[bandNumber - 1];
  }, [metadata]);

  const formatWavelength = useCallback((wavelength) => {
    if (wavelength === null || wavelength === undefined) return '';
    if (wavelength < 10) return `${wavelength.toFixed(3)} μm`;
    return `${Math.round(wavelength)} nm`;
  }, []);

  return (
    <div className="relative">
      {/* Band Selection Controls */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <h4 className="font-semibold mb-2 text-sm">Band Selection</h4>
        {loadingBands && <p className="text-blue-600 mb-2 text-xs">Loading new bands...</p>}
        
        <form onSubmit={handleSubmit} className="flex gap-2 flex-wrap">
          {['red', 'green', 'blue'].map((color, idx) => (
            <div key={color} className="flex items-center">
              <label className={`mr-1 font-medium text-${color}-600 text-xs`}>
                {color[0].toUpperCase()}:
              </label>
              <input
                type="number"
                className="border rounded px-1 py-1 w-12 text-xs"
                value={inputBands[color]}
                onChange={(e) => setInputBands({...inputBands, [color]: e.target.value})}
                min="1"
                max={metadata?.bands || 100}
                disabled={loadingBands}
              />
              <span className={`ml-1 text-xs text-${color}-600`}>
                {formatWavelength(getWavelengthForBand(bands[color]))}
              </span>
            </div>
          ))}
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs"
            disabled={loadingBands}
          >
            Update
          </button>
        </form>
      </div>

      {/* Normalization Controls */}
      <NormalizationControls 
        settings={normalizationSettings}
        onChange={setNormalizationSettings}
      />

      {/* Canvas Display */}
      <div className="relative">
        <canvas 
          ref={canvasRef} 
          style={{ 
            cursor: 'crosshair',
            maxWidth: '100%',
            height: 'auto',
            display: 'block'
          }} 
        />
        <canvas 
          ref={overlayCanvasRef} 
          style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            pointerEvents: 'none',
            maxWidth: '100%',
            height: 'auto',
            display: 'block'
          }} 
        />
      </div>

      {/* Spectral Graph */}
      {spectralGraph}
    </div>
  );
};

// Helper Components
const NormalizationControls = ({ settings, onChange }) => (
  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
    <h4 className="font-semibold mb-2 text-sm">Image Enhancement</h4>
    <div className="grid grid-cols-3 gap-2">
      {[
        { key: 'lowerPercentile', label: 'Lower', min: 0, max: 10, step: 0.5, mult: 100 },
        { key: 'upperPercentile', label: 'Upper', min: 90, max: 100, step: 0.5, mult: 100 },
        { key: 'gamma', label: 'Gamma', min: 0.2, max: 2.0, step: 0.05, mult: 1 }
      ].map(({ key, label, min, max, step, mult }) => (
        <div key={key}>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {label} ({Math.round(settings[key] * mult)}{mult === 100 ? '%' : ''})
          </label>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={settings[key] * mult}
            onChange={(e) => onChange({
              ...settings,
              [key]: Number(e.target.value) / mult
            })}
            className="w-full h-2"
          />
        </div>
      ))}
    </div>
  </div>
);

const SpectralGraph = ({ 
  spectralDataArray, metadata, bands, enableSharedSpectral, sharedContext,
  setLocalSpectralData, setLocalShowSpectral, setShowSpectralGraph, svgRef,
  hoveredPoint, setHoveredPoint, cursorPosition, setCursorPosition,
  editingIndex, setEditingIndex, editingName, setEditingName
}) => {
  // Calculate value range
  let spectrumMin = Infinity, spectrumMax = -Infinity;
  spectralDataArray.forEach(data => {
    if (!data.spectrum) return;
    data.spectrum.forEach(point => {
      if (point.value < spectrumMin) spectrumMin = point.value;
      if (point.value > spectrumMax) spectrumMax = point.value;
    });
  });

  const minValue = Math.max(0, spectrumMin * 0.9);
  const maxValue = spectrumMax * 1.1;

  // Calculate wavelength ranges and units
  const { globalMinWavelength, globalMaxWavelength, globalUnit, hasMultipleImages } = 
    calculateGlobalWavelengthRange(spectralDataArray);

  // Calculate band positions for RGB lines
  const bandPositions = calculateBandPositions(metadata, bands, globalMinWavelength, globalMaxWavelength, globalUnit, hasMultipleImages);

  // Chart dimensions
  const chartWidth = 300, chartHeight = 200;
  const paddingX = 50, paddingY = 30;
  const graphWidth = chartWidth - (paddingX * 2);
  const graphHeight = chartHeight - (paddingY * 2);

  // Generate axis ticks
  const xTicks = generateXTicks(spectralDataArray, globalMinWavelength, globalMaxWavelength, globalUnit, hasMultipleImages, paddingX, graphWidth);
  const yTicks = generateYTicks(minValue, maxValue, paddingY, graphHeight);

  const clearAllSpectra = () => {
    if (enableSharedSpectral) {
      sharedContext.clearAllSpectralData();
    } else {
      setLocalSpectralData([]);
      setLocalShowSpectral(false);
    }
  };

  const removeSpectrum = (index) => {
    if (enableSharedSpectral) {
      sharedContext.removeSpectralData(index);
    } else {
      const newArray = [...spectralDataArray];
      newArray.splice(index, 1);
      setLocalSpectralData(newArray);
    }
  };

  const handleMouseMove = (e) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - svgRect.left;

    if (x >= paddingX && x <= paddingX + graphWidth) {
      setCursorPosition(x);
      updateHoverPoints(x, spectralDataArray, paddingX, graphWidth, paddingY, graphHeight, 
        globalMinWavelength, globalMaxWavelength, globalUnit, hasMultipleImages, minValue, maxValue);
      
      // Set hovered point data for display
      const validHoverPoints = spectralDataArray
        .map(d => d.hoverPoint)
        .filter(point => point !== null && point !== undefined);

      if (validHoverPoints.length > 0) {
        const relativeX = (x - paddingX) / graphWidth;
        const globalWavelength = hasMultipleImages 
          ? globalMinWavelength + relativeX * (globalMaxWavelength - globalMinWavelength)
          : null;

        setHoveredPoint({ 
          x, 
          values: spectralDataArray.map(d => d.hoverPoint),
          wavelength: globalWavelength,
          band: null
        });
      } else {
        setHoveredPoint(null);
      }
    }
  };

  const handleMouseLeave = () => {
    setCursorPosition(null);
    setHoveredPoint(null);
    spectralDataArray.forEach(specData => {
      specData.hoverPoint = null;
    });
  };

  return (
    <div className="spectral-graph fixed bg-white border border-gray-300 shadow-lg p-4" 
         style={{ left: '20px', bottom: '20px', zIndex: 1000 }}>
      
      {/* Header */}
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold">
          Spectral Profiles ({spectralDataArray.length} pixels)
        </h3>
        <div>
          <ExportButton svgRef={svgRef} fileName={`spectral-profile-${new Date().toISOString().slice(0, 10)}`} />
          <button className="text-red-500 hover:text-red-700 mx-2" onClick={clearAllSpectra}>
            Clear All
          </button>
          <button className="text-gray-500 hover:text-gray-700" onClick={() => setShowSpectralGraph(false)}>
            ×
          </button>
        </div>
      </div>

      {/* SVG Chart */}
      <svg ref={svgRef} width={chartWidth} height={chartHeight} className="bg-gray-50" 
           onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
        
        {/* Grid lines */}
        {yTicks.map((tick, i) => (
          <line key={`y-grid-${i}`} x1={paddingX} y1={tick.y} x2={paddingX + graphWidth} y2={tick.y} 
                stroke="#ddd" strokeWidth="1" />
        ))}
        {xTicks.map((tick, i) => (
          <line key={`x-grid-${i}`} x1={tick.x} y1={paddingY} x2={tick.x} y2={paddingY + graphHeight} 
                stroke="#ddd" strokeWidth="1" />
        ))}

        {/* Axes */}
        <line x1={paddingX} y1={paddingY + graphHeight} x2={paddingX + graphWidth} y2={paddingY + graphHeight} 
              stroke="#333" strokeWidth="1" />
        <line x1={paddingX} y1={paddingY} x2={paddingX} y2={paddingY + graphHeight} 
              stroke="#333" strokeWidth="1" />

        {/* Axis ticks and labels */}
        {xTicks.map((tick, i) => (
          <React.Fragment key={`x-tick-${i}`}>
            <line x1={tick.x} y1={paddingY + graphHeight} x2={tick.x} y2={paddingY + graphHeight + 5} 
                  stroke="#333" strokeWidth="1" />
            <text x={tick.x} y={paddingY + graphHeight + 15} fontSize="10" textAnchor="middle">
              {tick.value}
            </text>
          </React.Fragment>
        ))}

        {yTicks.map((tick, i) => (
          <React.Fragment key={`y-tick-${i}`}>
            <line x1={paddingX - 5} y1={tick.y} x2={paddingX} y2={tick.y} stroke="#333" strokeWidth="1" />
            <text x={paddingX - 8} y={tick.y + 3} fontSize="10" textAnchor="end">{tick.value}</text>
          </React.Fragment>
        ))}

        {/* Spectral lines */}
        {spectralDataArray.map((specData, specIndex) => {
          if (!specData.spectrum || specData.spectrum.length === 0) return null;

          const points = generateSpectralLinePoints(specData, hasMultipleImages, globalMinWavelength, 
            globalMaxWavelength, globalUnit, paddingX, graphWidth, paddingY, graphHeight, minValue, maxValue);

          return (
            <React.Fragment key={`spectrum-${specIndex}`}>
              <polyline points={points} fill="none" stroke={specData.color} strokeWidth="2" />
              {specData.hoverPoint && (
                <circle cx={specData.hoverPoint.x} cy={specData.hoverPoint.y} r="3" 
                        fill={specData.color} stroke="#fff" strokeWidth="1" />
              )}
            </React.Fragment>
          );
        })}

        {/* RGB band lines - only show if single image mode */}
        {!enableSharedSpectral && (
          <>
            <line x1={paddingX + (bandPositions.red * graphWidth)} y1={paddingY} 
                  x2={paddingX + (bandPositions.red * graphWidth)} y2={paddingY + graphHeight} 
                  stroke="rgba(255, 0, 0, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
            <line x1={paddingX + (bandPositions.green * graphWidth)} y1={paddingY} 
                  x2={paddingX + (bandPositions.green * graphWidth)} y2={paddingY + graphHeight} 
                  stroke="rgba(0, 180, 0, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
            <line x1={paddingX + (bandPositions.blue * graphWidth)} y1={paddingY} 
                  x2={paddingX + (bandPositions.blue * graphWidth)} y2={paddingY + graphHeight} 
                  stroke="rgba(0, 0, 255, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
          </>
        )}

        {/* Cursor line */}
        {cursorPosition && (
          <line x1={cursorPosition} y1={paddingY} x2={cursorPosition} y2={paddingY + graphHeight} 
                stroke="#999" strokeWidth="1" strokeDasharray="2,2" />
        )}

        {/* Wavelength display */}
        {cursorPosition && hoveredPoint?.wavelength && (
          <text x={cursorPosition} y={paddingY - 5} fontSize="9" textAnchor="middle" fill="#666">
            {spectralDataArray.some(data => data.metadata?.wavelengthValues && data.metadata.wavelengthValues.length > 0)
              ? (hoveredPoint.wavelength < 10 
                  ? `${hoveredPoint.wavelength.toFixed(2)} μm`
                  : `${Math.round(hoveredPoint.wavelength)} nm`)
              : `Band ${hoveredPoint.band}`
            }
          </text>
        )}

        {/* Axis labels */}
        <text x={chartWidth / 2} y={chartHeight - 5} fontSize="10" textAnchor="middle">
          {xTicks.xAxisLabel}
        </text>
        <text x={15} y={paddingY + (graphHeight / 2)} fontSize="10" textAnchor="middle"
              transform={`rotate(-90, 15, ${paddingY + (graphHeight / 2)})`}>
          Digital Number (DN)
        </text>
      </svg>

      {/* Legend */}
      <div className="mt-2">
        {spectralDataArray.map((specData, index) => (
          <div key={`legend-${index}`} className="flex items-center justify-between text-xs mb-1">
            <div className="flex items-center">
              <div className="w-3 h-3 mr-1" style={{ backgroundColor: specData.color }}></div>
              {editingIndex === index ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => saveEdit(index, editingName, enableSharedSpectral, sharedContext, spectralDataArray, setLocalSpectralData, setEditingIndex, setEditingName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(index, editingName, enableSharedSpectral, sharedContext, spectralDataArray, setLocalSpectralData, setEditingIndex, setEditingName);
                    if (e.key === 'Escape') { setEditingIndex(null); setEditingName(''); }
                  }}
                  className="text-xs border rounded px-1"
                  autoFocus
                />
              ) : (
                <span
                  className="cursor-pointer hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingIndex(index);
                    setEditingName(specData.name);
                  }}
                >
                  {specData.imageSource && (
                    <span className="text-gray-500 text-xs mr-1">[{specData.imageSource}]</span>
                  )}
                  {specData.name}
                  {specData.hoverPoint && ` - ${Math.round(specData.hoverPoint.value)}`}
                </span>
              )}
            </div>
            <button
              className="text-gray-500 hover:text-red-500 ml-2"
              onClick={(e) => {
                e.stopPropagation();
                removeSpectrum(index);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// Utility Functions
function getInitialBands(loadedBands, metadata) {
  if (loadedBands?.length >= 3) {
    return { red: loadedBands[0], green: loadedBands[1], blue: loadedBands[2] };
  }
  return { red: 1, green: 1, blue: 1 };
}

function getInitialInputBands(loadedBands, metadata) {
  if (metadata?.defaultBands) {
    return {
      red: metadata.defaultBands[0].toString(),
      green: metadata.defaultBands[1].toString(),
      blue: metadata.defaultBands[2].toString()
    };
  }
  if (loadedBands?.length === 3) {
    return {
      red: loadedBands[0].toString(),
      green: loadedBands[1].toString(),
      blue: loadedBands[2].toString()
    };
  }
  return { red: '1', green: '1', blue: '1' };
}

function getCanvasCoordinates(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: Math.floor((event.clientX - rect.left) * scaleX),
    y: Math.floor((event.clientY - rect.top) * scaleY)
  };
}

function generateRandomColor() {
  return `rgb(${Math.floor(Math.random() * 200)}, ${Math.floor(Math.random() * 200)}, ${Math.floor(Math.random() * 200)})`;
}

function arraysEqual(a, b) {
  return a && b && a.length === b.length && a.every((val, i) => val === b[i]);
}

function calculateGlobalWavelengthRange(spectralDataArray) {
  let globalMinWavelength = Infinity;
  let globalMaxWavelength = -Infinity;
  let hasMultipleImages = false;
  let globalUnit = 'nm';

  const imageWavelengthRanges = new Map();

  const convertToNanometers = (wavelength, isInMicrometers) => {
    return isInMicrometers ? wavelength * 1000 : wavelength;
  };

  const isInMicrometers = (wavelengths) => {
    const avgWavelength = wavelengths.reduce((sum, wl) => sum + wl, 0) / wavelengths.length;
    return avgWavelength < 10;
  };

  spectralDataArray.forEach(data => {
    if (!data.spectrum || !data.metadata) return;
    
    const wavelengths = data.spectrum.map(point => point.wavelength);
    const isUsingMicrometers = isInMicrometers(wavelengths);
    
    const wavelengthsInNm = wavelengths.map(wl => convertToNanometers(wl, isUsingMicrometers));
    
    const minWl = Math.min(...wavelengthsInNm);
    const maxWl = Math.max(...wavelengthsInNm);
    
    globalMinWavelength = Math.min(globalMinWavelength, minWl);
    globalMaxWavelength = Math.max(globalMaxWavelength, maxWl);
    
    const imageKey = data.imageSource || 'single';
    if (!imageWavelengthRanges.has(imageKey)) {
      imageWavelengthRanges.set(imageKey, { 
        min: minWl, 
        max: maxWl, 
        originalMin: Math.min(...wavelengths),
        originalMax: Math.max(...wavelengths),
        unit: isUsingMicrometers ? 'μm' : 'nm'
      });
    }
  });

  hasMultipleImages = imageWavelengthRanges.size > 1;

  if (hasMultipleImages) {
    const ranges = Array.from(imageWavelengthRanges.values());
    const hasNanometers = ranges.some(r => r.unit === 'nm');
    const hasMicrometers = ranges.some(r => r.unit === 'μm');
    
    if ((hasNanometers && hasMicrometers) || globalMaxWavelength > 10000) {
      globalUnit = 'nm';
    } else if (globalMaxWavelength < 10) {
      globalUnit = 'μm';
      globalMinWavelength = globalMinWavelength / 1000;
      globalMaxWavelength = globalMaxWavelength / 1000;
    }
  }

  return { globalMinWavelength, globalMaxWavelength, globalUnit, hasMultipleImages };
}

function calculateBandPositions(metadata, bands, globalMinWavelength, globalMaxWavelength, globalUnit, hasMultipleImages) {
  const bandPositions = {};
  
  if (metadata.wavelengthValues) {
    const wavelengths = metadata.wavelengthValues;
    const currentIsInMicrometers = wavelengths.reduce((sum, wl) => sum + wl, 0) / wavelengths.length < 10;
    
    let minWavelength, maxWavelength, range;
    
    if (hasMultipleImages) {
      if (globalUnit === 'nm' && currentIsInMicrometers) {
        const convertedWavelengths = wavelengths.map(wl => wl * 1000);
        minWavelength = globalMinWavelength;
        maxWavelength = globalMaxWavelength;
        range = maxWavelength - minWavelength;
        
        if (range > 0) {
          bandPositions.red = (convertedWavelengths[bands.red - 1] - minWavelength) / range;
          bandPositions.green = (convertedWavelengths[bands.green - 1] - minWavelength) / range;
          bandPositions.blue = (convertedWavelengths[bands.blue - 1] - minWavelength) / range;
        }
      } else if (globalUnit === 'μm' && !currentIsInMicrometers) {
        const convertedWavelengths = wavelengths.map(wl => wl / 1000);
        minWavelength = globalMinWavelength;
        maxWavelength = globalMaxWavelength;
        range = maxWavelength - minWavelength;
        
        if (range > 0) {
          bandPositions.red = (convertedWavelengths[bands.red - 1] - minWavelength) / range;
          bandPositions.green = (convertedWavelengths[bands.green - 1] - minWavelength) / range;
          bandPositions.blue = (convertedWavelengths[bands.blue - 1] - minWavelength) / range;
        }
      } else {
        minWavelength = globalMinWavelength;
        maxWavelength = globalMaxWavelength;
        range = maxWavelength - minWavelength;
        
        if (range > 0) {
          bandPositions.red = (wavelengths[bands.red - 1] - minWavelength) / range;
          bandPositions.green = (wavelengths[bands.green - 1] - minWavelength) / range;
          bandPositions.blue = (wavelengths[bands.blue - 1] - minWavelength) / range;
        }
      }
    } else {
      minWavelength = Math.min(...wavelengths);
      maxWavelength = Math.max(...wavelengths);
      range = maxWavelength - minWavelength;

      if (range > 0) {
        bandPositions.red = (wavelengths[bands.red - 1] - minWavelength) / range;
        bandPositions.green = (wavelengths[bands.green - 1] - minWavelength) / range;
        bandPositions.blue = (wavelengths[bands.blue - 1] - minWavelength) / range;
      }
    }
    
    if (range <= 0) {
      bandPositions.red = 0.75;
      bandPositions.green = 0.45;
      bandPositions.blue = 0.15;
    }
  } else {
    bandPositions.red = (bands.red - 1) / (metadata.bands - 1);
    bandPositions.green = (bands.green - 1) / (metadata.bands - 1);
    bandPositions.blue = (bands.blue - 1) / (metadata.bands - 1);
  }

  return bandPositions;
}

function generateXTicks(spectralDataArray, globalMinWavelength, globalMaxWavelength, globalUnit, hasMultipleImages, paddingX, graphWidth) {
  const firstSpectrum = spectralDataArray[0]?.spectrum || [];
  const xTickCount = Math.min(9, firstSpectrum.length);
  const xTicks = [];
  let xAxisLabel = "Band";

  if (firstSpectrum.length > 0) {
    const minWavelength = hasMultipleImages ? globalMinWavelength : Math.min(...firstSpectrum.map(d => d.wavelength));
    const maxWavelength = hasMultipleImages ? globalMaxWavelength : Math.max(...firstSpectrum.map(d => d.wavelength));
    const hasRealWavelengthData = spectralDataArray.some(data => 
      data.metadata?.wavelengthValues && data.metadata.wavelengthValues.length > 0
    );

    if (hasRealWavelengthData) {
      for (let i = 0; i < xTickCount; i++) {
        const wavelengthValue = minWavelength + (i / (xTickCount - 1)) * (maxWavelength - minWavelength);
        const xPosition = paddingX + (i / (xTickCount - 1)) * graphWidth;

        let formattedValue;
        if (wavelengthValue >= 100) {
          formattedValue = Math.round(wavelengthValue).toString();
        } else if (wavelengthValue >= 10) {
          formattedValue = wavelengthValue.toFixed(1);
        } else if (wavelengthValue >= 1) {
          formattedValue = wavelengthValue.toFixed(2);
        } else {
          formattedValue = wavelengthValue.toFixed(3).substring(0, 4);
        }

        xTicks.push({ x: xPosition, value: formattedValue });
      }
      xAxisLabel = hasMultipleImages ? `Wavelength (${globalUnit})` : (maxWavelength < 10 ? "Wavelength (μm)" : "Wavelength (nm)");
    } else {
      for (let i = 0; i < xTickCount; i++) {
        const bandNum = Math.floor(1 + i * (firstSpectrum.length - 1) / (xTickCount - 1));
        const xPosition = paddingX + (i / (xTickCount - 1)) * graphWidth;
        xTicks.push({ x: xPosition, value: bandNum });
      }
    }
  }

  xTicks.xAxisLabel = xAxisLabel;
  return xTicks;
}

function generateYTicks(minValue, maxValue, paddingY, graphHeight) {
  const yTickCount = 5;
  const yTicks = [];

  for (let i = 0; i < yTickCount; i++) {
    const value = 0 + (i / (yTickCount - 1)) * (maxValue - minValue);
    const y = paddingY + graphHeight - (i / (yTickCount - 1)) * graphHeight;
    yTicks.push({ y, value: Math.round(value) });
  }

  return yTicks;
}

function generateSpectralLinePoints(specData, hasMultipleImages, globalMinWavelength, globalMaxWavelength, globalUnit, paddingX, graphWidth, paddingY, graphHeight, minValue, maxValue) {
  if (!specData.spectrum || specData.spectrum.length === 0) return '';

  const sortedData = [...specData.spectrum].sort((a, b) => a.wavelength - b.wavelength);

  if (hasMultipleImages) {
    const spectrumWavelengths = sortedData.map(d => d.wavelength);
    const spectrumIsInMicrometers = spectrumWavelengths.reduce((sum, wl) => sum + wl, 0) / spectrumWavelengths.length < 10;
    
    return sortedData.map((point) => {
      let wavelengthInGlobalUnits = point.wavelength;
      if (globalUnit === 'nm' && spectrumIsInMicrometers) {
        wavelengthInGlobalUnits = point.wavelength * 1000;
      } else if (globalUnit === 'μm' && !spectrumIsInMicrometers) {
        wavelengthInGlobalUnits = point.wavelength / 1000;
      }
      
      const globalRange = globalMaxWavelength - globalMinWavelength;
      const x = paddingX + ((wavelengthInGlobalUnits - globalMinWavelength) / globalRange) * graphWidth;
      const y = paddingY + graphHeight - ((point.value - minValue) / (maxValue - minValue) * graphHeight);
      return `${x},${y}`;
    }).join(' ');
  } else {
    return sortedData.map((point, index) => {
      const x = paddingX + (index / (sortedData.length - 1)) * graphWidth;
      const y = paddingY + graphHeight - ((point.value - minValue) / (maxValue - minValue) * graphHeight);
      return `${x},${y}`;
    }).join(' ');
  }
}

function updateHoverPoints(x, spectralDataArray, paddingX, graphWidth, paddingY, graphHeight, globalMinWavelength, globalMaxWavelength, globalUnit, hasMultipleImages, minValue, maxValue) {
  const relativeX = (x - paddingX) / graphWidth;
  const globalWavelength = hasMultipleImages 
    ? globalMinWavelength + relativeX * (globalMaxWavelength - globalMinWavelength)
    : null;

  spectralDataArray.forEach((specData) => {
    if (!specData.spectrum) return;

    const sortedData = [...specData.spectrum].sort((a, b) => a.wavelength - b.wavelength);
    const spectrumIsInMicrometers = sortedData.reduce((sum, d) => sum + d.wavelength, 0) / sortedData.length < 10;
    
    const spectrumMinWl = Math.min(...sortedData.map(d => d.wavelength));
    const spectrumMaxWl = Math.max(...sortedData.map(d => d.wavelength));
    
    if (hasMultipleImages && globalWavelength) {
      let targetWavelength = globalWavelength;
      if (globalUnit === 'nm' && spectrumIsInMicrometers) {
        targetWavelength = globalWavelength / 1000;
      } else if (globalUnit === 'μm' && !spectrumIsInMicrometers) {
        targetWavelength = globalWavelength * 1000;
      }
      
      if (targetWavelength < spectrumMinWl || targetWavelength > spectrumMaxWl) {
        specData.hoverPoint = null;
        return;
      }
      
      let closestIndex = 0;
      let minDiff = Math.abs(sortedData[0].wavelength - targetWavelength);
      
      for (let i = 1; i < sortedData.length; i++) {
        const diff = Math.abs(sortedData[i].wavelength - targetWavelength);
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = i;
        }
      }
      
      if (closestIndex >= 0 && closestIndex < sortedData.length) {
        const value = sortedData[closestIndex].value;
        const wavelength = sortedData[closestIndex].wavelength;
        
        let wavelengthInGlobalUnits = wavelength;
        if (globalUnit === 'nm' && spectrumIsInMicrometers) {
          wavelengthInGlobalUnits = wavelength * 1000;
        } else if (globalUnit === 'μm' && !spectrumIsInMicrometers) {
          wavelengthInGlobalUnits = wavelength / 1000;
        }
        
        const globalRange = globalMaxWavelength - globalMinWavelength;
        const xPos = paddingX + ((wavelengthInGlobalUnits - globalMinWavelength) / globalRange) * graphWidth;
        const yPos = paddingY + graphHeight - ((value - minValue) / (maxValue - minValue) * graphHeight);

        specData.hoverPoint = { value, wavelength, x: xPos, y: yPos };
      }
    } else {
      const exactIndex = relativeX * (sortedData.length - 1);
      const dataIndex = Math.round(exactIndex);

      if (dataIndex >= 0 && dataIndex < sortedData.length) {
        const value = sortedData[dataIndex].value;
        const wavelength = sortedData[dataIndex].wavelength;
        const xPos = paddingX + (dataIndex / (sortedData.length - 1)) * graphWidth;
        const yPos = paddingY + graphHeight - ((value - minValue) / (maxValue - minValue) * graphHeight);

        specData.hoverPoint = { value, wavelength, x: xPos, y: yPos };
      }
    }
  });
}

function saveEdit(index, editingName, enableSharedSpectral, sharedContext, spectralDataArray, setLocalSpectralData, setEditingIndex, setEditingName) {
  if (editingName.trim()) {
    if (enableSharedSpectral) {
      sharedContext.updateSpectralData(index, { name: editingName.trim() });
    } else {
      const newArray = [...spectralDataArray];
      newArray[index].name = editingName.trim();
      setLocalSpectralData(newArray);
    }
  }
  setEditingIndex(null);
  setEditingName('');
}

export default ImageRenderer;