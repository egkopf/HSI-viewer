import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { parseSpecificBands, extractPixelSpectrum } from '../utils/parseHyperspectral';
import { parseGeoTIFFBands, extractGeoTIFFPixelSpectrum } from '../utils/parseGeoTIFF';
import { isValidPixelValue } from '../utils/dataValidation';
import { useSharedSpectral } from '../utils/sharedSpectralContent';

const ExportButton = ({ svgRef, fileName = "spectral-profile" }) => {
  const handleExport = () => {
    if (!svgRef.current) return;
    const svgElement = svgRef.current;
    const svgClone = svgElement.cloneNode(true);
    svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svgData = new XMLSerializer().serializeToString(svgClone);
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
    <button
      onClick={handleExport}
      className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
      title="Export as SVG"
    >
      Export
    </button>
  );
};

const ImageRenderer = ({ 
  bandData, 
  metadata, 
  loadedBands, 
  dataFile, 
  fileType,
  enableSharedSpectral = false,
  isMainSpectralDisplay = true
}) => {
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  // Check if we're using band numbers instead of wavelengths - MOVE THIS UP EARLY
  const usingBandNumbers = metadata?.usingBandNumbers === true || (!metadata?.hasRealWavelengths && !metadata?.wavelengthValues);

  // Zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  // Always call the hook, but conditionally use its values
  const sharedContext = useSharedSpectral();
  const [localSpectralData, setLocalSpectralData] = useState([]);
  const [localShowSpectral, setLocalShowSpectral] = useState(false);

  const spectralDataArray = enableSharedSpectral ? sharedContext.sharedSpectralData : localSpectralData;
  const showSpectralGraph = enableSharedSpectral ? sharedContext.showSharedSpectralGraph : localShowSpectral;
  const setShowSpectralGraph = enableSharedSpectral ? sharedContext.setShowSharedSpectralGraph : setLocalShowSpectral;

  // Initialize bands from metadata or loadedBands
  const [bands, setBands] = useState(() => {
    if (loadedBands?.length >= 3) {
      return {
        red: loadedBands[0],
        green: loadedBands[1], 
        blue: loadedBands[2]
      };
    }
    return { red: 1, green: 1, blue: 1 };
  });

  // Separate input state for form values
  const [inputBands, setInputBands] = useState(() => {
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
  });

  // Wavelength editing state
  const [editingWavelengths, setEditingWavelengths] = useState(false);
  const [wavelengthInputs, setWavelengthInputs] = useState('');
  const [wavelengthUnit, setWavelengthUnit] = useState('nm');

  const [currentBandData, setCurrentBandData] = useState(bandData);
  const [currentLoadedBands, setCurrentLoadedBands] = useState(loadedBands);
  const [loadingBands, setLoadingBands] = useState(false);

  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [cursorPosition, setCursorPosition] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingName, setEditingName] = useState('');

  const [normalizationSettings, setNormalizationSettings] = useState({
    lowerPercentile: 0.01,
    upperPercentile: 0.99,
    gamma: 0.65
  });

  // Scroll zoom toggle state
  const [scrollZoomEnabled, setScrollZoomEnabled] = useState(false);

  // Initialize bands from metadata when it becomes available
  useEffect(() => {
    if (metadata?.defaultBands) {
      const newBands = {
        red: metadata.defaultBands[0],
        green: metadata.defaultBands[1],
        blue: metadata.defaultBands[2]
      };
      setBands(newBands);
      setInputBands({
        red: metadata.defaultBands[0].toString(),
        green: metadata.defaultBands[1].toString(),
        blue: metadata.defaultBands[2].toString()
      });
    } else if (loadedBands?.length === 3) {
      const newBands = {
        red: loadedBands[0],
        green: loadedBands[1],
        blue: loadedBands[2]
      };
      setBands(newBands);
      setInputBands({
        red: loadedBands[0].toString(),
        green: loadedBands[1].toString(),
        blue: loadedBands[2].toString()
      });
    }

    // Initialize wavelength inputs when metadata changes
    if (metadata?.wavelengthValues) {
      const wavelengths = metadata.wavelengthValues;
      const avgWavelength = wavelengths.reduce((sum, wl) => sum + wl, 0) / wavelengths.length;
      const detectedUnit = avgWavelength < 10 ? 'µm' : 'nm';
      
      setWavelengthUnit(detectedUnit);
      setWavelengthInputs(wavelengths.map(w => w.toFixed(detectedUnit === 'µm' ? 3 : 0)).join(', '));
    } else {
      setWavelengthInputs('');
      setWavelengthUnit('nm');
    }
  }, [metadata, loadedBands]);

  // Update current data when props change
  useEffect(() => {
    setCurrentBandData(bandData);
    setCurrentLoadedBands(loadedBands);
  }, [bandData, loadedBands]);

  // Reset zoom when new file is loaded
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setHasDragged(false);
  }, [dataFile]);

  // Load new bands when band selection changes
  const loadNewBands = useCallback(async (newBands) => {
    if (!dataFile || !metadata) return;

    const newBandNumbers = [newBands.red, newBands.green, newBands.blue];

    // Check if we already have these bands loaded
    if (currentLoadedBands &&
      currentLoadedBands[0] === newBandNumbers[0] &&
      currentLoadedBands[1] === newBandNumbers[1] &&
      currentLoadedBands[2] === newBandNumbers[2]) {
      return; // Already loaded
    }

    try {
      setLoadingBands(true);
      console.log('Loading new bands:', newBandNumbers);

      let newBandData;
      if (metadata.fileType === 'geotiff') {
        console.log('Using GeoTIFF parser for band change');
        newBandData = await parseGeoTIFFBands(dataFile, metadata, newBandNumbers);
      } else {
        console.log('Using ENVI parser for band change');
        newBandData = await parseSpecificBands(dataFile, metadata, newBandNumbers);
      }

      setCurrentBandData(newBandData);
      setCurrentLoadedBands(newBandNumbers);
      setLoadingBands(false);
    } catch (error) {
      console.error('Error loading bands:', error);
      setLoadingBands(false);
      alert('Failed to load bands: ' + error.message);
    }
  }, [dataFile, metadata, currentLoadedBands]);

  // Convert display coordinates to image coordinates
  const displayToImageCoords = useCallback((displayX, displayY) => {
    if (!canvasRef.current || !metadata || !containerRef.current) return { x: -1, y: -1 };
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    // Calculate relative position within the container
    const relativeX = displayX - containerRect.left;
    const relativeY = displayY - containerRect.top;
    
    // Reverse the zoom and pan transform to get position on the base canvas
    const baseCanvasX = (relativeX - pan.x) / zoom;
    const baseCanvasY = (relativeY - pan.y) / zoom;
    
    // Get the canvas as it appears at zoom=1 (its natural CSS-scaled size)
    const canvasRect = canvas.getBoundingClientRect();
    const baseCanvasWidth = canvasRect.width / zoom;  // Actual displayed size at zoom=1
    const baseCanvasHeight = canvasRect.height / zoom;
    
    // Scale from base canvas display size to actual canvas pixels
    const scaleX = canvas.width / baseCanvasWidth;
    const scaleY = canvas.height / baseCanvasHeight;
    
    const pixelX = Math.floor(baseCanvasX * scaleX);
    const pixelY = Math.floor(baseCanvasY * scaleY);
    
    return { x: pixelX, y: pixelY };
  }, [zoom, pan, metadata]);

  // Render the image data to the canvas
  useEffect(() => {
    if (!currentBandData || !metadata || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const samples = parseInt(metadata.samples, 10);
    const lines = parseInt(metadata.lines, 10);

    if (isNaN(samples) || isNaN(lines)) return;

    canvas.width = samples;
    canvas.height = lines;

    const imageData = ctx.createImageData(samples, lines);
    const data = imageData.data;

    // Optimized band statistics calculation
    const calculateBandStats = (bandIndex) => {
      if (!currentBandData[bandIndex]) return { min: 0, max: 65535 };

      const values = [];
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

      return { min, max };
    };

    // Calculate stats for each RGB band
    const bandStats = {
      red: calculateBandStats(0),
      green: calculateBandStats(1),
      blue: calculateBandStats(2)
    };

    // Pre-calculate normalization values
    const redRange = bandStats.red.max - bandStats.red.min;
    const greenRange = bandStats.green.max - bandStats.green.min;
    const blueRange = bandStats.blue.max - bandStats.blue.min;
    const gamma = normalizationSettings.gamma;

    // Pre-allocate band data references
    const redBand = currentBandData[0];
    const greenBand = currentBandData[1];
    const blueBand = currentBandData[2];

    // Fast normalization function
    const fastNormalize = (value, min, range) => {
      if (!isValidPixelValue(value, metadata) || range <= 0) return 0;

      let normalized = (value - min) / range;
      normalized = Math.max(0, Math.min(1, normalized));
      return Math.floor(Math.pow(normalized, gamma) * 255);
    };

    // Process pixels
    let dataIndex = 0;
    
    for (let line = 0; line < lines; line++) {
      const redLine = redBand[line];
      const greenLine = greenBand[line];
      const blueLine = blueBand[line];
      
      if (!redLine || !greenLine || !blueLine) {
        for (let sample = 0; sample < samples; sample++) {
          data[dataIndex++] = 0; // R
          data[dataIndex++] = 0; // G
          data[dataIndex++] = 0; // B
          data[dataIndex++] = 255; // A
        }
        continue;
      }

      const isEdgeLine = (line === 0 || line === lines - 1);

      for (let sample = 0; sample < samples; sample++) {
        const isEdgePixel = isEdgeLine || (sample === 0 || sample === samples - 1);
        
        if (isEdgePixel) {
          data[dataIndex++] = 0; // R
          data[dataIndex++] = 0; // G
          data[dataIndex++] = 0; // B
          data[dataIndex++] = 255; // A
          continue;
        }

        const redValue = redLine[sample];
        const greenValue = greenLine[sample];
        const blueValue = blueLine[sample];

        const isIgnored = !isValidPixelValue(redValue, metadata) || 
                         !isValidPixelValue(greenValue, metadata) || 
                         !isValidPixelValue(blueValue, metadata);
        
        if (isIgnored) {
          data[dataIndex++] = 0; // R
          data[dataIndex++] = 0; // G
          data[dataIndex++] = 0; // B
          data[dataIndex++] = 255; // A
        } else {
          data[dataIndex++] = fastNormalize(redValue, bandStats.red.min, redRange);
          data[dataIndex++] = fastNormalize(greenValue, bandStats.green.min, greenRange);
          data[dataIndex++] = fastNormalize(blueValue, bandStats.blue.min, blueRange);
          data[dataIndex++] = 255; // A
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    
    if (overlayCanvasRef.current) {
      overlayCanvasRef.current.width = samples;
      overlayCanvasRef.current.height = lines;
    }
  }, [currentBandData, metadata, bands, normalizationSettings]);

  // Draw pixel borders on overlay canvas
  useEffect(() => {
    if (!overlayCanvasRef.current || !metadata) return;
    
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas.getContext('2d');
    
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    spectralDataArray.forEach((specData) => {
      const { x, y } = specData.position;
      ctx.fillStyle = specData.color;
      
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
  }, [spectralDataArray, metadata]);

  const handlePixelClick = useCallback(async (event) => {
    if (!dataFile || !metadata || !canvasRef.current || hasDragged) return;

    const { x, y } = displayToImageCoords(event.clientX, event.clientY);

    if (x < 0 || x >= metadata.samples || y < 0 || y >= metadata.lines) {
      return;
    }

    try {
      console.log(`Extracting spectrum for pixel (${x}, ${y})`);
      
      let pixelSpectrum;
      if (metadata.fileType === 'geotiff') {
        pixelSpectrum = await extractGeoTIFFPixelSpectrum(dataFile, metadata, x, y);
      } else {
        pixelSpectrum = await extractPixelSpectrum(dataFile, metadata, x, y);
      }

      const validValues = pixelSpectrum.filter(point => point.value > 0);

      if (validValues.length === 0 || validValues.length < pixelSpectrum.length * 0.1) {
        console.log(`Pixel (${x}, ${y}) has no valid spectral data - ignoring`);
        return;
      }

      const randomColor = `rgb(${Math.floor(Math.random() * 200)}, ${Math.floor(Math.random() * 200)}, ${Math.floor(Math.random() * 200)})`;

      const newSpectralData = {
        spectrum: pixelSpectrum,
        position: { x, y },
        color: randomColor,
        name: `Pixel (${x}, ${y})`,
        imageSource: enableSharedSpectral ? (isMainSpectralDisplay ? 'img 1' : 'img 2') : null,
        metadata: metadata
      };

      if (enableSharedSpectral) {
        sharedContext.addSpectralData(newSpectralData);
      } else {
        setLocalSpectralData(prevArray => [...prevArray, newSpectralData]);
        setLocalShowSpectral(true);
      }
    } catch (error) {
      console.error('Error extracting pixel spectrum:', error);
      alert('Failed to extract spectral data: ' + error.message);
    }
  }, [dataFile, metadata, enableSharedSpectral, sharedContext, displayToImageCoords, hasDragged, isMainSpectralDisplay]);

  // Handle zoom with mouse wheel
  const handleWheel = useCallback((event) => {
    // Only handle zoom if scroll zoom is enabled
    if (!scrollZoomEnabled) {
      return; // Let the event bubble up for normal page scrolling
    }

    // Prevent default page scroll when zoom is enabled
    event.preventDefault();
    
    const delta = -event.deltaY;
    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    const newZoom = Math.max(1, zoom * zoomFactor);
    
    if (newZoom === zoom) return; // No change if at minimum zoom
    
    const container = containerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    if (newZoom === 1) {
      // Smooth transition back to base view
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      // Calculate new pan to keep mouse position stationary
      const newPan = {
        x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
        y: mouseY - (mouseY - pan.y) * (newZoom / zoom)
      };
      
      setZoom(newZoom);
      setPan(newPan);
    }
  }, [zoom, pan, scrollZoomEnabled]);

  // Handle mouse down for panning
  const handleMouseDown = useCallback((event) => {
    if (zoom > 1) { // Only allow panning when zoomed in
      setIsDragging(true);
      setHasDragged(false);
      setLastMousePos({ x: event.clientX, y: event.clientY });
    }
  }, [zoom]);

  // Handle mouse move for panning
  const handleMouseMove = useCallback((event) => {
    if (!isDragging || zoom <= 1) return; // Only pan when dragging and zoomed in
    
    const deltaX = event.clientX - lastMousePos.x;
    const deltaY = event.clientY - lastMousePos.y;
    
    // Mark as dragged if there's significant movement
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      setHasDragged(true);
    }
    
    setPan(prev => {
      const newPan = {
        x: prev.x + deltaX,
        y: prev.y + deltaY
      };
      
      // Constrain pan to reasonable bounds when zoomed in
      if (!canvasRef.current || !containerRef.current) return newPan;
      
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      
      const scaledWidth = canvas.width * zoom;
      const scaledHeight = canvas.height * zoom;
      
      // Don't allow panning beyond the image boundaries
      newPan.x = Math.min(0, Math.max(containerRect.width - scaledWidth, newPan.x));
      newPan.y = Math.min(0, Math.max(containerRect.height - scaledHeight, newPan.y));
      
      return newPan;
    });
    
    setLastMousePos({ x: event.clientX, y: event.clientY });
  }, [isDragging, lastMousePos, zoom]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Set up event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleCanvasClick = async (event) => {
      if (!currentBandData || !canvasRef.current || hasDragged) return;

      const { x, y } = displayToImageCoords(event.clientX, event.clientY);

      if (x < 0 || x >= metadata.samples || y < 0 || y >= metadata.lines) {
        return;
      }

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

    container.addEventListener('click', handleCanvasClick);
    container.addEventListener('wheel', handleWheel, { passive: !scrollZoomEnabled });
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseUp);

    return () => {
      container.removeEventListener('click', handleCanvasClick);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [handlePixelClick, currentBandData, metadata, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp, scrollZoomEnabled, displayToImageCoords, hasDragged]);

  // Handle clicking outside the graph
  useEffect(() => {
    if (!showSpectralGraph) return;

    const handleOutsideClick = (event) => {
      const isClickOnGraph = event.target.closest('.spectral-graph');
      const isClickOnCanvas = event.target.closest('.image-container');

      if (!isClickOnGraph && !isClickOnCanvas) {
        setShowSpectralGraph(false);
      }
    };

    document.addEventListener('click', handleOutsideClick);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [showSpectralGraph, setShowSpectralGraph]);

  const clearAllSpectra = useCallback(() => {
    if (enableSharedSpectral) {
      sharedContext.clearAllSpectralData();
    } else {
      setLocalSpectralData([]);
      setLocalShowSpectral(false);
    }
  }, [enableSharedSpectral, sharedContext]);

  useEffect(() => {
    if (enableSharedSpectral) {
      sharedContext.clearAllSpectralData();
    } else {
      setLocalSpectralData([]);
      setLocalShowSpectral(false);
    }
  }, [dataFile, enableSharedSpectral]);

  // Handle form submission for band selection
  const handleSubmit = async (e) => {
    e.preventDefault();

    const redBand = parseInt(inputBands.red, 10);
    const greenBand = parseInt(inputBands.green, 10);
    const blueBand = parseInt(inputBands.blue, 10);

    const maxBand = metadata.bands;
    const isValid =
      !isNaN(redBand) && redBand >= 1 && redBand <= maxBand &&
      !isNaN(greenBand) && greenBand >= 1 && greenBand <= maxBand &&
      !isNaN(blueBand) && blueBand >= 1 && blueBand <= maxBand;

    if (isValid) {
      const newBands = { red: redBand, green: greenBand, blue: blueBand };
      setBands(newBands);
      await loadNewBands(newBands);
    } else {
      alert(`Please enter valid band numbers between 1 and ${maxBand}`);
    }
  };

  // Helper functions
  const getWavelengthForBand = useCallback((bandNumber) => {
    if (!metadata || !metadata.wavelengthValues ||
      bandNumber < 1 || bandNumber > metadata.bands) {
      return null;
    }
    return metadata.wavelengthValues[bandNumber - 1];
  }, [metadata]);

  const formatWavelength = useCallback((wavelength) => {
    if (wavelength === null || wavelength === undefined) return '';

    if (wavelength < 10) {
      return `${wavelength.toFixed(3)} μm`;
    }
    return `${Math.round(wavelength)} nm`;
  }, []);

  // Handle wavelength updates
  const handleWavelengthUpdate = () => {
    if (!metadata || !wavelengthInputs.trim()) return;

    try {
      const inputWavelengths = wavelengthInputs
        .split(',')
        .map(w => parseFloat(w.trim()))
        .filter(w => !isNaN(w) && w > 0);

      if (inputWavelengths.length !== metadata.bands) {
        alert(`Please enter exactly ${metadata.bands} wavelength values to match the number of bands.`);
        return;
      }

      // Convert to nanometers if needed for consistency
      const wavelengthsInNm = wavelengthUnit === 'µm' 
        ? inputWavelengths.map(w => w * 1000) 
        : inputWavelengths;

      // Update metadata (this would need to be passed up to parent in real implementation)
      if (metadata.wavelengthValues) {
        metadata.wavelengthValues = wavelengthsInNm;
        metadata.hasRealWavelengths = true;
        metadata.wavelengthSource = `user edit (${wavelengthUnit})`;
        metadata.usingBandNumbers = false;
      }

      setEditingWavelengths(false);
      // alert('Wavelengths updated successfully!');
    } catch (error) {
      alert('Invalid wavelength format. Please enter numeric values separated by commas.');
    }
  };

  const cancelWavelengthEdit = () => {
    // Reset to original values
    if (metadata?.wavelengthValues) {
      const wavelengths = metadata.wavelengthValues;
      const avgWavelength = wavelengths.reduce((sum, wl) => sum + wl, 0) / wavelengths.length;
      const detectedUnit = avgWavelength < 10 ? 'µm' : 'nm';
      
      setWavelengthUnit(detectedUnit);
      setWavelengthInputs(wavelengths.map(w => w.toFixed(detectedUnit === 'µm' ? 3 : 0)).join(', '));
    } else {
      setWavelengthInputs('');
    }
    setEditingWavelengths(false);
  };

  // Filter spectral data to prevent mixed types (wavelengths vs band numbers)
  const filteredSpectralDataArray = useMemo(() => {
    return spectralDataArray.filter((data, index) => {
      if (!data.spectrum || !data.metadata) return false;
      
      // Always include first spectrum
      if (index === 0) return true;
      
      // Check if first spectrum has real wavelengths
      const firstSpecHasRealWavelengths = spectralDataArray[0].metadata?.wavelengthValues && 
        spectralDataArray[0].metadata.wavelengthValues.length > 0 && 
        !spectralDataArray[0].metadata?.usingBandNumbers;
      
      // Check if current spectrum has real wavelengths
      const currentSpecHasRealWavelengths = data.metadata?.wavelengthValues && 
        data.metadata.wavelengthValues.length > 0 && 
        !data.metadata?.usingBandNumbers;
      
      // Only include if both have same type (both wavelengths or both band numbers)
      return firstSpecHasRealWavelengths === currentSpecHasRealWavelengths;
    });
  }, [spectralDataArray]);

  // Only render spectral graph on the main display
  const shouldShowSpectralGraph = isMainSpectralDisplay && showSpectralGraph && spectralDataArray.length > 0;

  // Spectral graph component with proper wavelength positioning
  const spectralGraph = useMemo(() => {
    if (!shouldShowSpectralGraph) {
      return null;
    }

    let spectrumMin = Infinity;
    let spectrumMax = -Infinity;

    filteredSpectralDataArray.forEach(data => {
      if (!data.spectrum) return;
      data.spectrum.forEach(point => {
        if (point.value < spectrumMin) spectrumMin = point.value;
        if (point.value > spectrumMax) spectrumMax = point.value;
      });
    });

    const minValue = Math.max(0, spectrumMin * 0.9);
    const maxValue = spectrumMax * 1.1;

    // Calculate global wavelength range from all images with unit conversion
    let globalMinWavelength = Infinity;
    let globalMaxWavelength = -Infinity;
    let hasMultipleImages = false;
    let globalUnit = 'nm'; // Default to nanometers

    const imageWavelengthRanges = new Map();

    // Helper function to convert wavelengths to nanometers for comparison
    const convertToNanometers = (wavelength, isInMicrometers) => {
      return isInMicrometers ? wavelength * 1000 : wavelength;
    };

    // Helper function to detect if wavelengths are in micrometers
    const isInMicrometers = (wavelengths) => {
      const avgWavelength = wavelengths.reduce((sum, wl) => sum + wl, 0) / wavelengths.length;
      return avgWavelength < 10; // If average is less than 10, likely micrometers
    };

    filteredSpectralDataArray.forEach(data => {
      if (!data.spectrum || !data.metadata) return;
      
      const wavelengths = data.spectrum.map(point => point.wavelength);
      const isUsingMicrometers = isInMicrometers(wavelengths);
      
      // Convert to nanometers for global comparison
      const wavelengthsInNm = wavelengths.map(wl => convertToNanometers(wl, isUsingMicrometers));
      
      const minWl = Math.min(...wavelengthsInNm);
      const maxWl = Math.max(...wavelengthsInNm);
      
      globalMinWavelength = Math.min(globalMinWavelength, minWl);
      globalMaxWavelength = Math.max(globalMaxWavelength, maxWl);
      
      // Track wavelength ranges per image
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

    // Check if we have data from multiple images
    hasMultipleImages = imageWavelengthRanges.size > 1;

    // Determine best global unit for display
    if (hasMultipleImages) {
      const ranges = Array.from(imageWavelengthRanges.values());
      const hasNanometers = ranges.some(r => r.unit === 'nm');
      const hasMicrometers = ranges.some(r => r.unit === 'μm');
      
      // Use nanometers if we have mixed units or if global range is large
      if ((hasNanometers && hasMicrometers) || globalMaxWavelength > 10000) {
        globalUnit = 'nm';
      } else if (globalMaxWavelength < 10) {
        globalUnit = 'μm';
        // Convert global range back to micrometers for display
        globalMinWavelength = globalMinWavelength / 1000;
        globalMaxWavelength = globalMaxWavelength / 1000;
      }
    }

    const bandPositions = {};
    if (metadata.wavelengthValues && !usingBandNumbers) {
      const wavelengths = metadata.wavelengthValues;
      const currentIsInMicrometers = isInMicrometers(wavelengths);
      
      let minWavelength, maxWavelength, range;
      
      if (hasMultipleImages) {
        // Use global range, converting current metadata to match global unit
        if (globalUnit === 'nm' && currentIsInMicrometers) {
          // Convert current wavelengths to nm for positioning
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
          // Convert current wavelengths to μm for positioning
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
          // Same units
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
        // Single image - use original behavior
        minWavelength = Math.min(...wavelengths);
        maxWavelength = Math.max(...wavelengths);
        range = maxWavelength - minWavelength;

        if (range > 0) {
          bandPositions.red = (wavelengths[bands.red - 1] - minWavelength) / range;
          bandPositions.green = (wavelengths[bands.green - 1] - minWavelength) / range;
          bandPositions.blue = (wavelengths[bands.blue - 1] - minWavelength) / range;
        }
      }
      
      // Fallback if range calculation failed
      if (range <= 0) {
        bandPositions.red = 0.75;
        bandPositions.green = 0.45;
        bandPositions.blue = 0.15;
      }
    } else {
      // Using band numbers
      bandPositions.red = (bands.red - 1) / (metadata.bands - 1);
      bandPositions.green = (bands.green - 1) / (metadata.bands - 1);
      bandPositions.blue = (bands.blue - 1) / (metadata.bands - 1);
    }

    const chartWidth = 480;
    const chartHeight = 260;
    const paddingX = 60;
    const paddingY = 40;
    const graphWidth = chartWidth - (paddingX * 2);
    const graphHeight = chartHeight - (paddingY * 2);

    // Calculate global band range for band number displays
    let globalMinBand = 1;
    let globalMaxBand = 1;
    
    if (usingBandNumbers || !filteredSpectralDataArray.some(data => 
      data.metadata?.wavelengthValues && data.metadata.wavelengthValues.length > 0 && !data.metadata?.usingBandNumbers
    )) {
      // Find the global band range across all spectra
      filteredSpectralDataArray.forEach(data => {
        if (data.spectrum && data.spectrum.length > 0) {
          const bands = data.spectrum.map(point => point.band || point.wavelength);
          const minBand = Math.min(...bands);
          const maxBand = Math.max(...bands);
          globalMinBand = Math.min(globalMinBand, minBand);
          globalMaxBand = Math.max(globalMaxBand, maxBand);
        }
      });
    }

    // Use global wavelength range for x-axis ticks when multiple images
    const firstSpectrum = filteredSpectralDataArray[0]?.spectrum || [];
    const xTickCount = Math.min(9, usingBandNumbers ? (globalMaxBand - globalMinBand + 1) : firstSpectrum.length);
    const xTicks = [];

    let xAxisLabel = "Band";

    if (firstSpectrum.length > 0) {
      const minWavelength = hasMultipleImages ? globalMinWavelength : Math.min(...firstSpectrum.map(d => d.wavelength));
      const maxWavelength = hasMultipleImages ? globalMaxWavelength : Math.max(...firstSpectrum.map(d => d.wavelength));
      const hasRealWavelengthData = filteredSpectralDataArray.some(data => 
        data.metadata?.wavelengthValues && data.metadata.wavelengthValues.length > 0 && !data.metadata?.usingBandNumbers
      );

      if (hasRealWavelengthData && !usingBandNumbers) {
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

          xTicks.push({
            x: xPosition,
            value: formattedValue
          });
        }
        xAxisLabel = hasMultipleImages ? `Wavelength (${globalUnit})` : (maxWavelength < 10 ? "Wavelength (μm)" : "Wavelength (nm)");
      } else {
        // Use global band range for tick positioning
        const bandRange = globalMaxBand - globalMinBand;
        for (let i = 0; i < xTickCount; i++) {
          const bandNum = Math.floor(globalMinBand + i * bandRange / (xTickCount - 1));
          const xPosition = paddingX + (i / (xTickCount - 1)) * graphWidth;
          xTicks.push({
            x: xPosition,
            value: bandNum
          });
        }
      }
    }

    const yTickCount = 5;
    const yTicks = [];

    for (let i = 0; i < yTickCount; i++) {
      const value = 0 + (i / (yTickCount - 1)) * (maxValue - minValue);
      const y = paddingY + graphHeight - (i / (yTickCount - 1)) * graphHeight;
      yTicks.push({
        y,
        value: Math.round(value)
      });
    }

    const removeSpectrum = (index) => {
      if (enableSharedSpectral) {
        sharedContext.removeSpectralData(index);
      } else {
        const newArray = [...spectralDataArray];
        newArray.splice(index, 1);
        setLocalSpectralData(newArray);
      }
    };

    const startEditing = (index) => {
      setEditingIndex(index);
      setEditingName(spectralDataArray[index].name);
    };

    const saveEdit = () => {
      if (editingIndex !== null && editingName.trim()) {
        if (enableSharedSpectral) {
          sharedContext.updateSpectralData(editingIndex, { name: editingName.trim() });
        } else {
          const newArray = [...spectralDataArray];
          newArray[editingIndex].name = editingName.trim();
          setLocalSpectralData(newArray);
        }
      }
      setEditingIndex(null);
      setEditingName('');
    };

    const cancelEdit = () => {
      setEditingIndex(null);
      setEditingName('');
    };

    const handleMouseMove = (e) => {
      const svgRect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - svgRect.left;

      if (x >= paddingX && x <= paddingX + graphWidth) {
        setCursorPosition(x);
        const relativeX = (x - paddingX) / graphWidth;

        // Convert relative x to global wavelength
        const globalWavelength = hasMultipleImages 
          ? globalMinWavelength + relativeX * (globalMaxWavelength - globalMinWavelength)
          : null;

        spectralDataArray.forEach((specData) => {
          if (!specData.spectrum) return;

          const sortedData = [...specData.spectrum].sort((a, b) => a.wavelength - b.wavelength);
          const spectrumIsInMicrometers = isInMicrometers(sortedData.map(d => d.wavelength));
          const hasRealWavelengths = specData.metadata?.wavelengthValues && specData.metadata.wavelengthValues.length > 0 && !specData.metadata?.usingBandNumbers;
          
          if (hasMultipleImages && globalWavelength && hasRealWavelengths) {
            // Convert global wavelength to spectrum's units for comparison
            let targetWavelength = globalWavelength;
            if (globalUnit === 'nm' && spectrumIsInMicrometers) {
              targetWavelength = globalWavelength / 1000; // Convert nm to μm
            } else if (globalUnit === 'μm' && !spectrumIsInMicrometers) {
              targetWavelength = globalWavelength * 1000; // Convert μm to nm
            }
            
            // Check if the target wavelength is within this spectrum's actual range
            const spectrumMinWl = Math.min(...sortedData.map(d => d.wavelength));
            const spectrumMaxWl = Math.max(...sortedData.map(d => d.wavelength));
            
            if (targetWavelength < spectrumMinWl || targetWavelength > spectrumMaxWl) {
              // Clear hover point for this spectrum if outside its range
              specData.hoverPoint = null;
              return;
            }
            
            // Find closest wavelength in this spectrum to the target
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
              
              // Calculate x position based on global scale
              let wavelengthInGlobalUnits = wavelength;
              if (globalUnit === 'nm' && spectrumIsInMicrometers) {
                wavelengthInGlobalUnits = wavelength * 1000;
              } else if (globalUnit === 'μm' && !spectrumIsInMicrometers) {
                wavelengthInGlobalUnits = wavelength / 1000;
              }
              
              const globalRange = globalMaxWavelength - globalMinWavelength;
              const xPos = paddingX + ((wavelengthInGlobalUnits - globalMinWavelength) / globalRange) * graphWidth;
              const yPos = paddingY + graphHeight - ((value - minValue) / (maxValue - minValue) * graphHeight);

              specData.hoverPoint = {
                value,
                wavelength,
                x: xPos,
                y: yPos
              };
            }
          } else if (hasRealWavelengths && !usingBandNumbers) {
            // Single image with real wavelengths - use actual wavelength spacing
            const spectrumMinWl = Math.min(...sortedData.map(d => d.wavelength));
            const spectrumMaxWl = Math.max(...sortedData.map(d => d.wavelength));
            const spectrumRange = spectrumMaxWl - spectrumMinWl;
            
            const targetWavelength = spectrumMinWl + relativeX * spectrumRange;
            
            // Find closest wavelength
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
              
              // Position based on actual wavelength
              const xPos = paddingX + ((wavelength - spectrumMinWl) / spectrumRange) * graphWidth;
              const yPos = paddingY + graphHeight - ((value - minValue) / (maxValue - minValue) * graphHeight);

              specData.hoverPoint = {
                value,
                wavelength,
                x: xPos,
                y: yPos
              };
            }
          } else {
            // Handle band number positioning with global band range
            const cursorBandNumber = globalMinBand + relativeX * (globalMaxBand - globalMinBand);
            
            // Find the closest band in this spectrum
            let closestPoint = null;
            let minDistance = Infinity;
            
            sortedData.forEach(point => {
              const bandNumber = point.band || point.wavelength;
              const distance = Math.abs(bandNumber - cursorBandNumber);
              if (distance < minDistance) {
                minDistance = distance;
                closestPoint = point;
              }
            });

            if (closestPoint) {
              const value = closestPoint.value;
              const wavelength = closestPoint.wavelength;
              const bandNumber = closestPoint.band || closestPoint.wavelength;
              const bandRange = globalMaxBand - globalMinBand;
              // Handle single band case (avoid division by zero)
              const xPos = bandRange === 0 ? paddingX + graphWidth / 2 : paddingX + ((bandNumber - globalMinBand) / bandRange) * graphWidth;
              const yPos = paddingY + graphHeight - ((value - minValue) / (maxValue - minValue) * graphHeight);

              specData.hoverPoint = {
                value,
                wavelength,
                band: bandNumber,
                x: xPos,
                y: yPos
              };
            }
          }
        });

        // Filter out spectra that don't have valid hover points for the legend display
        const validHoverPoints = spectralDataArray
          .map(d => d.hoverPoint)
          .filter(point => point !== null && point !== undefined);

        let cursorWavelength = globalWavelength;
        let cursorBand = null;
        
        if (!hasMultipleImages && firstSpectrum.length > 0) {
          const sortedData = [...firstSpectrum].sort((a, b) => a.wavelength - b.wavelength);
          const hasRealWavelengths = filteredSpectralDataArray[0]?.metadata?.wavelengthValues && filteredSpectralDataArray[0].metadata.wavelengthValues.length > 0 && !filteredSpectralDataArray[0].metadata?.usingBandNumbers;
          
          if (hasRealWavelengths && !usingBandNumbers) {
            // Calculate wavelength based on linear interpolation of actual wavelength values
            const spectrumMinWl = Math.min(...sortedData.map(d => d.wavelength));
            const spectrumMaxWl = Math.max(...sortedData.map(d => d.wavelength));
            const spectrumRange = spectrumMaxWl - spectrumMinWl;
            
            cursorWavelength = spectrumMinWl + relativeX * spectrumRange;
            
            // Find the closest band for reference
            let closestIndex = 0;
            let minDiff = Math.abs(sortedData[0].wavelength - cursorWavelength);
            
            for (let i = 1; i < sortedData.length; i++) {
              const diff = Math.abs(sortedData[i].wavelength - cursorWavelength);
              if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
              }
            }
            cursorBand = sortedData[closestIndex].band;
          } else {
            // Band-based calculation using global band range
            const cursorBandNumber = globalMinBand + relativeX * (globalMaxBand - globalMinBand);
            cursorBand = Math.round(cursorBandNumber);
            
            // Find the closest actual band in the first spectrum for wavelength display
            let closestPoint = null;
            let minDistance = Infinity;
            
            sortedData.forEach(point => {
              const bandNumber = point.band || point.wavelength;
              const distance = Math.abs(bandNumber - cursorBandNumber);
              if (distance < minDistance) {
                minDistance = distance;
                closestPoint = point;
              }
            });
            
            if (closestPoint) {
              cursorWavelength = closestPoint.wavelength;
              cursorBand = closestPoint.band || closestPoint.wavelength;
            }
          }
        } else if (hasMultipleImages && globalWavelength) {
          // Use the calculated global wavelength
          cursorWavelength = globalWavelength;
        }

        // Only set hover point if we have at least one valid hover point
        if (validHoverPoints.length > 0) {
          setHoveredPoint({ 
            x, 
            values: spectralDataArray.map(d => d.hoverPoint),
            wavelength: cursorWavelength,
            band: cursorBand
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
      <div className="spectral-graph fixed bg-white border border-gray-200 shadow-xl rounded-lg overflow-hidden" style={{ left: '20px', bottom: '20px', zIndex: 1000 }}>
        {/* Header */}
        <div className="bg-gray-50 border-b border-gray-200 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-medium text-gray-900">
                Spectral Profiles
              </h3>
              <span className="text-xs text-gray-500">
                ({filteredSpectralDataArray.length} pixels)
              </span>
            </div>
            <div className="flex items-center space-x-1">
              <ExportButton svgRef={svgRef} fileName={`spectral-profile-${new Date().toISOString().slice(0, 10)}`} />
              <button
                className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50"
                onClick={clearAllSpectra}
                title="Clear all spectra"
              >
                Clear
              </button>
              <button
                className="text-gray-400 hover:text-gray-600 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100"
                onClick={() => setShowSpectralGraph(false)}
                title="Close"
              >
                ×
              </button>
            </div>
          </div>
          {/* Status indicators */}
          {(usingBandNumbers || spectralDataArray.length > filteredSpectralDataArray.length) && (
            <div className="flex flex-wrap gap-1 mt-2">
              {usingBandNumbers && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                  Band numbers
                </span>
              )}
              {spectralDataArray.length > filteredSpectralDataArray.length && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                  {spectralDataArray.length - filteredSpectralDataArray.length} hidden
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* Chart area */}
        <div className="p-3">
        <svg ref={svgRef} width={chartWidth} height={chartHeight} className="bg-gray-50" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
          {yTicks.map((tick, i) => (
            <line
              key={`y-grid-${i}`}
              x1={paddingX}
              y1={tick.y}
              x2={paddingX + graphWidth}
              y2={tick.y}
              stroke="#ddd"
              strokeWidth="1"
            />
          ))}

          {xTicks.map((tick, i) => (
            <line
              key={`x-grid-${i}`}
              x1={tick.x}
              y1={paddingY}
              x2={tick.x}
              y2={paddingY + graphHeight}
              stroke="#ddd"
              strokeWidth="1"
            />
          ))}

          <line x1={paddingX} y1={paddingY + graphHeight} x2={paddingX + graphWidth} y2={paddingY + graphHeight} stroke="#333" strokeWidth="1" />
          <line x1={paddingX} y1={paddingY} x2={paddingX} y2={paddingY + graphHeight} stroke="#333" strokeWidth="1" />

          {xTicks.map((tick, i) => (
            <React.Fragment key={`x-tick-${i}`}>
              <line x1={tick.x} y1={paddingY + graphHeight} x2={tick.x} y2={paddingY + graphHeight + 5} stroke="#333" strokeWidth="1" />
              <text x={tick.x} y={paddingY + graphHeight + 15} fontSize="10" textAnchor="middle">{tick.value}</text>
            </React.Fragment>
          ))}

          {yTicks.map((tick, i) => (
            <React.Fragment key={`y-tick-${i}`}>
              <line x1={paddingX - 5} y1={tick.y} x2={paddingX} y2={tick.y} stroke="#333" strokeWidth="1" />
              <text x={paddingX - 8} y={tick.y + 3} fontSize="10" textAnchor="end">{tick.value}</text>
            </React.Fragment>
          ))}

          {filteredSpectralDataArray.map((specData, specIndex) => {
            if (!specData.spectrum || specData.spectrum.length === 0) return null;

            const sortedData = [...specData.spectrum].sort((a, b) => a.wavelength - b.wavelength);
            const hasRealWavelengths = specData.metadata?.wavelengthValues && specData.metadata.wavelengthValues.length > 0 && !specData.metadata?.usingBandNumbers;

            let points;
            if ((hasMultipleImages || hasRealWavelengths) && !usingBandNumbers) {
              // Use actual wavelength positioning for proper spacing
              const spectrumWavelengths = sortedData.map(d => d.wavelength);
              const spectrumIsInMicrometers = isInMicrometers(spectrumWavelengths);
              
              points = sortedData.map((point) => {
                // Convert wavelength to global units if needed
                let wavelengthInGlobalUnits = point.wavelength;
                if (globalUnit === 'nm' && spectrumIsInMicrometers) {
                  wavelengthInGlobalUnits = point.wavelength * 1000; // μm to nm
                } else if (globalUnit === 'μm' && !spectrumIsInMicrometers) {
                  wavelengthInGlobalUnits = point.wavelength / 1000; // nm to μm
                }
                
                const globalRange = globalMaxWavelength - globalMinWavelength;
                const x = paddingX + ((wavelengthInGlobalUnits - globalMinWavelength) / globalRange) * graphWidth;
                const y = paddingY + graphHeight - ((point.value - minValue) / (maxValue - minValue) * graphHeight);
                return `${x},${y}`;
              }).join(' ');
            } else {
              // Position based on actual band numbers when using band numbers
              points = sortedData.map((point) => {
                const bandNumber = point.band || point.wavelength;
                const bandRange = globalMaxBand - globalMinBand;
                // Handle single band case (avoid division by zero)
                const x = bandRange === 0 ? paddingX + graphWidth / 2 : paddingX + ((bandNumber - globalMinBand) / bandRange) * graphWidth;
                const y = paddingY + graphHeight - ((point.value - minValue) / (maxValue - minValue) * graphHeight);
                return `${x},${y}`;
              }).join(' ');
            }

            return (
              <React.Fragment key={`spectrum-${specIndex}`}>
                <polyline points={points} fill="none" stroke={specData.color} strokeWidth="2" />

                {specData.hoverPoint && (
                  <circle
                    cx={specData.hoverPoint.x}
                    cy={specData.hoverPoint.y}
                    r="3"
                    fill={specData.color}
                    stroke="#fff"
                    strokeWidth="1"
                  />
                )}
              </React.Fragment>
            );
          })}

          {(() => {
            // Check if we have pixels from multiple images
            const imageSourcesWithPixels = new Set(
              spectralDataArray.map(data => data.imageSource).filter(source => source)
            );
            const hasPixelsFromMultipleImages = imageSourcesWithPixels.size > 1;
            
            // NEW: Also check if we're in dual-file mode (enableSharedSpectral indicates dual mode)
            const isDualFileMode = enableSharedSpectral;
            
            // Only show RGB bands if we don't have pixels from multiple images AND not in dual-file mode AND not using band numbers
            if (!hasPixelsFromMultipleImages && !isDualFileMode && !usingBandNumbers) {
              return (
                <>
                  <line x1={paddingX + (bandPositions.red * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.red * graphWidth)}
                    y2={paddingY + graphHeight} stroke="rgba(255, 0, 0, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
                  <line x1={paddingX + (bandPositions.green * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.green * graphWidth)}
                    y2={paddingY + graphHeight} stroke="rgba(0, 180, 0, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
                  <line x1={paddingX + (bandPositions.blue * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.blue * graphWidth)}
                    y2={paddingY + graphHeight} stroke="rgba(0, 0, 255, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
                </>
              );
            }
            return null;
          })()}

          {cursorPosition && (
            <line x1={cursorPosition} y1={paddingY} x2={cursorPosition} y2={paddingY + graphHeight} stroke="#999" strokeWidth="1" strokeDasharray="2,2" />
          )}

          {cursorPosition && hoveredPoint?.wavelength && (
            <text 
              x={cursorPosition} 
              y={paddingY - 5} 
              fontSize="9" 
              textAnchor="middle" 
              fill="#666"
            >
              {filteredSpectralDataArray.some(data => data.metadata?.wavelengthValues && data.metadata.wavelengthValues.length > 0 && !data.metadata?.usingBandNumbers)
                ? (hoveredPoint.wavelength < 10 
                    ? `${hoveredPoint.wavelength.toFixed(2)} μm`
                    : `${Math.round(hoveredPoint.wavelength)} nm`)
                : `Band ${hoveredPoint.band}`
              }
            </text>
          )}

          <text x={chartWidth / 2} y={chartHeight - 5} fontSize="10" textAnchor="middle" fill="#6b7280">{xAxisLabel}</text>
          <text x={15} y={paddingY + (graphHeight / 2)} fontSize="10" textAnchor="middle" fill="#6b7280"
            transform={`rotate(-90, 15, ${paddingY + (graphHeight / 2)})`}>Digital Number (DN)</text>
        </svg>
        </div>

        {/* Legend */}
        {spectralDataArray.length > 0 && (
          <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 max-h-32 overflow-y-auto">
            <div className="space-y-1">
              {spectralDataArray.map((specData, index) => (
                <div key={`legend-${index}`} className="flex items-center justify-between group">
                  <div className="flex items-center min-w-0 flex-1">
                    <div
                      className="w-3 h-3 rounded-sm mr-2 flex-shrink-0"
                      style={{ backgroundColor: specData.color }}
                    ></div>
                    {editingIndex === index ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white flex-1 min-w-0"
                        autoFocus
                      />
                    ) : (
                      <div 
                        className="cursor-pointer hover:text-gray-900 flex-1 min-w-0 text-xs text-gray-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(index);
                        }}
                      >
                        {specData.imageSource && (
                          <span className="text-gray-400 mr-1">[{specData.imageSource}]</span>
                        )}
                        <span className="truncate">
                          {specData.name}
                          {specData.hoverPoint && (
                            <span className="text-gray-500 ml-1">
                              - {Math.round(specData.hoverPoint.value)}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    className="text-gray-400 hover:text-red-500 ml-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSpectrum(index);
                    }}
                    title="Remove spectrum"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }, [filteredSpectralDataArray, shouldShowSpectralGraph, metadata, bands, hoveredPoint, cursorPosition, editingIndex, editingName, enableSharedSpectral, sharedContext, clearAllSpectra, setShowSpectralGraph, usingBandNumbers]);

  return (
    <div className="relative">
      {/* Band Selection and Wavelength Editor Controls */}
      <div className="mb-2 bg-gray-50 border border-gray-200 rounded-md p-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Band Selection - Left Side */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-xs text-gray-700">RGB Bands</h4>
              {loadingBands && (
                <span className="text-xs text-blue-600">Loading...</span>
              )}
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-red-600">R</label>
                  <input
                    type="number"
                    name="red"
                    className="w-12 border border-gray-300 rounded px-1 py-0.5 text-xs text-center focus:ring-1 focus:ring-red-500 focus:border-red-500"
                    value={inputBands.red}
                    onChange={(e) => setInputBands({ ...inputBands, red: e.target.value })}
                    min="1"
                    max={metadata?.bands || 100}
                    disabled={loadingBands}
                  />
                  {!usingBandNumbers && (
                    <span className="text-xs text-red-500">
                      {formatWavelength(getWavelengthForBand(bands.red))}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-green-600">G</label>
                  <input
                    type="number"
                    name="green"
                    className="w-12 border border-gray-300 rounded px-1 py-0.5 text-xs text-center focus:ring-1 focus:ring-green-500 focus:border-green-500"
                    value={inputBands.green}
                    onChange={(e) => setInputBands({ ...inputBands, green: e.target.value })}
                    min="1"
                    max={metadata?.bands || 100}
                    disabled={loadingBands}
                  />
                  {!usingBandNumbers && (
                    <span className="text-xs text-green-500">
                      {formatWavelength(getWavelengthForBand(bands.green))}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-blue-600">B</label>
                  <input
                    type="number"
                    name="blue"
                    className="w-12 border border-gray-300 rounded px-1 py-0.5 text-xs text-center focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    value={inputBands.blue}
                    onChange={(e) => setInputBands({ ...inputBands, blue: e.target.value })}
                    min="1"
                    max={metadata?.bands || 100}
                    disabled={loadingBands}
                  />
                  {!usingBandNumbers && (
                    <span className="text-xs text-blue-500">
                      {formatWavelength(getWavelengthForBand(bands.blue))}
                    </span>
                  )}
                </div>
              </div>
              
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
                disabled={loadingBands}
              >
                Update RGB
              </button>
            </form>
          </div>

          {/* Wavelength Editor - Right Side */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-medium text-xs text-gray-700">
                Wavelengths ({metadata?.bands || 0})
              </h4>
              {usingBandNumbers && (
                <span className="text-xs bg-amber-100 text-amber-700 px-1 py-0.5 rounded">
                  Bands
                </span>
              )}
            </div>
              
            {editingWavelengths ? (
              <div className="space-y-2">
                <textarea
                  value={wavelengthInputs}
                  onChange={(e) => setWavelengthInputs(e.target.value)}
                  placeholder="Enter wavelengths separated by commas"
                  className="w-full text-xs border border-gray-300 rounded px-1 py-1 h-12 resize-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600">Unit:</span>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        value="nm"
                        checked={wavelengthUnit === 'nm'}
                        onChange={(e) => setWavelengthUnit(e.target.value)}
                      />
                      <span>nm</span>
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        value="µm"
                        checked={wavelengthUnit === 'µm'}
                        onChange={(e) => setWavelengthUnit(e.target.value)}
                      />
                      <span>µm</span>
                    </label>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={handleWavelengthUpdate}
                      className="bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded text-xs"
                    >
                      Apply
                    </button>
                    <button
                      onClick={cancelWavelengthEdit}
                      className="bg-gray-500 hover:bg-gray-600 text-white px-2 py-0.5 rounded text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div 
                className="text-xs text-gray-600 bg-white border border-gray-200 rounded px-1 py-1 h-8 overflow-y-auto cursor-pointer hover:bg-gray-50 hover:border-blue-300 transition-colors" 
                onClick={() => metadata && setEditingWavelengths(true)}
                title={metadata ? "Click to edit wavelengths" : "No data available"}
              >
                {metadata?.wavelengthValues && !usingBandNumbers ? (
                  <span>
                    {metadata.wavelengthValues.slice(0, 6).map(w => 
                      w < 10 ? w.toFixed(3) : Math.round(w)
                    ).join(', ')}
                    {metadata.wavelengthValues.length > 6 && '...'}
                    {' '}
                    {metadata.wavelengthValues[0] < 10 ? 'μm' : 'nm'}
                  </span>
                ) : (
                  <span className="italic text-gray-500">
                    {usingBandNumbers ? 'Band numbers' : 'No wavelength data'}
                    {metadata && <span className="text-blue-500 ml-1">• Click to edit</span>}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Normalization controls */}
      <div className="mb-2 p-2 bg-gray-50 rounded">
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-medium text-xs">Enhancement</h4>
          <button
            onClick={() => setScrollZoomEnabled(!scrollZoomEnabled)}
            className={`text-xs px-2 py-1 rounded border ${
              scrollZoomEnabled 
                ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600' 
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
            title={scrollZoomEnabled ? 'Scroll to zoom (enabled)' : 'Scroll to zoom (disabled)'}
          >
            🔍
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <div>
            <label className="block text-xs text-gray-600 mb-0.5">
              Low ({Math.round(normalizationSettings.lowerPercentile * 100)}%)
            </label>
            <input
              type="range"
              min="0"
              max="10"
              step="0.5"
              value={normalizationSettings.lowerPercentile * 100}
              onChange={(e) => setNormalizationSettings({
                ...normalizationSettings,
                lowerPercentile: Number(e.target.value) / 100
              })}
              className="w-full h-1"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-0.5">
              High ({Math.round(normalizationSettings.upperPercentile * 100)}%)
            </label>
            <input
              type="range"
              min="90"
              max="100"
              step="0.5"
              value={normalizationSettings.upperPercentile * 100}
              onChange={(e) => setNormalizationSettings({
                ...normalizationSettings,
                upperPercentile: Number(e.target.value) / 100
              })}
              className="w-full h-1"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-0.5">
              Gamma ({normalizationSettings.gamma.toFixed(2)})
            </label>
            <input
              type="range"
              min="0.2"
              max="2.0"
              step="0.05"
              value={normalizationSettings.gamma}
              onChange={(e) => setNormalizationSettings({
                ...normalizationSettings,
                gamma: Number(e.target.value)
              })}
              className="w-full h-1"
            />
          </div>
        </div>
      </div>

      {/* Zoom info */}
      <div className="mb-2 text-xs text-gray-600">
        Zoom: {zoom.toFixed(1)}x | {scrollZoomEnabled ? 'Mouse wheel to zoom' : 'Click scroll button to enable zoom'}{zoom > 1 ? ', drag to pan' : ''}
      </div>

      {/* Image container with zoom and pan */}
      <div 
        ref={containerRef}
        className="image-container relative overflow-hidden border border-gray-300"
        style={{ 
          cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'crosshair',
          width: '100%'
        }}
      >
        <div 
          className="transition-transform duration-200 ease-out"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: '0 0',
            width: 'fit-content'
          }}
        >
          <canvas 
            ref={canvasRef} 
            style={{ 
              display: 'block',
              maxWidth: '100%',
              height: 'auto'
            }} 
          />
          <canvas 
            ref={overlayCanvasRef} 
            style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              pointerEvents: 'none',
              display: 'block',
              maxWidth: '100%',
              height: 'auto'
            }} 
          />
        </div>
      </div>

      {/* Spectral graph popup - only show on main display */}
      {spectralGraph}
    </div>
  );
};

export default ImageRenderer;