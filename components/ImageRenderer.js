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
      className="text-blue-500 hover:text-blue-700 text-sm mr-2"
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
  enableSharedSpectral = false,
  isMainSpectralDisplay = true
}) => {
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const svgRef = useRef(null);

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
  }, [metadata, loadedBands]);

  // Update current data when props change
  useEffect(() => {
    setCurrentBandData(bandData);
    setCurrentLoadedBands(loadedBands);
  }, [bandData, loadedBands]);

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

  // Render the image data to the canvas (same as before - unchanged)
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
    if (!dataFile || !metadata || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((event.clientX - rect.left) * scaleX);
    const y = Math.floor((event.clientY - rect.top) * scaleY);

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
        metadata: metadata // Store metadata to access wavelength info later
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
  }, [dataFile, metadata, enableSharedSpectral, sharedContext]);

  // Set up event listeners (same as before)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleCanvasClick = async (event) => {
      if (!currentBandData || !canvasRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = Math.floor((event.clientX - rect.left) * scaleX);
      const y = Math.floor((event.clientY - rect.top) * scaleY);

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

    canvas.addEventListener('click', handleCanvasClick);
    return () => {
      canvas.removeEventListener('click', handleCanvasClick);
    };
  }, [handlePixelClick, currentBandData, metadata]);

  // Handle clicking outside the graph
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
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [showSpectralGraph]);

  const clearAllSpectra = () => {
    if (enableSharedSpectral) {
      sharedContext.clearAllSpectralData();
    } else {
      setLocalSpectralData([]);
      setLocalShowSpectral(false);
    }
  };

  useEffect(() => {
    if (enableSharedSpectral) {
      sharedContext.clearAllSpectralData();
    } else {
      setLocalSpectralData([]);
      setLocalShowSpectral(false);
    }
  }, [dataFile]);

  // Handle form submission for band selection (same as before)
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

  // Helper functions (same as before)
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

  // Normalization Controls component (same as before)
  const NormalizationControls = () => (
  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
    <h4 className="font-semibold mb-2 text-sm">Image Enhancement</h4>
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Lower ({Math.round(normalizationSettings.lowerPercentile * 100)}%)
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
            className="w-full h-2"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Upper ({Math.round(normalizationSettings.upperPercentile * 100)}%)
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
            className="w-full h-2"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
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
            className="w-full h-2"
          />
        </div>
      </div>
    </div>
  </div>
);

  // Only render spectral graph on the main display
  const shouldShowSpectralGraph = isMainSpectralDisplay && showSpectralGraph && spectralDataArray.length > 0;

  // Simplified spectral graph (keeping your existing implementation but only showing on main display)
  const spectralGraph = useMemo(() => {
    if (!shouldShowSpectralGraph) {
      return null;
    }

    let spectrumMin = Infinity;
    let spectrumMax = -Infinity;

    spectralDataArray.forEach(data => {
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

    spectralDataArray.forEach(data => {
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
    if (metadata.wavelengthValues) {
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
      bandPositions.red = (bands.red - 1) / (metadata.bands - 1);
      bandPositions.green = (bands.green - 1) / (metadata.bands - 1);
      bandPositions.blue = (bands.blue - 1) / (metadata.bands - 1);
    }

    const chartWidth = 300;
    const chartHeight = 200;
    const paddingX = 50;
    const paddingY = 30;
    const graphWidth = chartWidth - (paddingX * 2);
    const graphHeight = chartHeight - (paddingY * 2);

    // Use global wavelength range for x-axis ticks when multiple images
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

          xTicks.push({
            x: xPosition,
            value: formattedValue
          });
        }
        xAxisLabel = hasMultipleImages ? `Wavelength (${globalUnit})` : (maxWavelength < 10 ? "Wavelength (μm)" : "Wavelength (nm)");
      } else {
        for (let i = 0; i < xTickCount; i++) {
          const bandNum = Math.floor(1 + i * (firstSpectrum.length - 1) / (xTickCount - 1));
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
          
          // Get the actual wavelength range for this specific spectrum
          const spectrumMinWl = Math.min(...sortedData.map(d => d.wavelength));
          const spectrumMaxWl = Math.max(...sortedData.map(d => d.wavelength));
          
          if (hasMultipleImages && globalWavelength) {
            // Convert global wavelength to spectrum's units for comparison
            let targetWavelength = globalWavelength;
            if (globalUnit === 'nm' && spectrumIsInMicrometers) {
              targetWavelength = globalWavelength / 1000; // Convert nm to μm
            } else if (globalUnit === 'μm' && !spectrumIsInMicrometers) {
              targetWavelength = globalWavelength * 1000; // Convert μm to nm
            }
            
            // Check if the target wavelength is within this spectrum's actual range
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
          } else {
            // Original behavior for single image
            const exactIndex = relativeX * (sortedData.length - 1);
            const dataIndex = Math.round(exactIndex);

            if (dataIndex >= 0 && dataIndex < sortedData.length) {
              const value = sortedData[dataIndex].value;
              const wavelength = sortedData[dataIndex].wavelength;
              const xPos = paddingX + (dataIndex / (sortedData.length - 1)) * graphWidth;
              const yPos = paddingY + graphHeight - ((value - minValue) / (maxValue - minValue) * graphHeight);

              specData.hoverPoint = {
                value,
                wavelength,
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
          const exactIndex = relativeX * (sortedData.length - 1);
          const dataIndex = Math.round(exactIndex);
          
          if (dataIndex >= 0 && dataIndex < sortedData.length) {
            cursorWavelength = sortedData[dataIndex].wavelength;
            cursorBand = sortedData[dataIndex].band;
          }
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
      <div className="spectral-graph fixed bg-white border border-gray-300 shadow-lg p-4" style={{ left: '20px', bottom: '20px', zIndex: 1000 }}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold">
            Spectral Profiles ({spectralDataArray.length} pixels)&nbsp;&nbsp;
          </h3>
          <div>
            <ExportButton svgRef={svgRef} fileName={`spectral-profile-${new Date().toISOString().slice(0, 10)}`} />
            <button
              className="text-red-500 hover:text-red-700 mx-2"
              onClick={clearAllSpectra}
            >
              Clear All
            </button>
            <button
              className="text-gray-500 hover:text-gray-700"
              onClick={() => setShowSpectralGraph(false)}
            >
              ×
            </button>
          </div>
        </div>
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

          {spectralDataArray.map((specData, specIndex) => {
            if (!specData.spectrum || specData.spectrum.length === 0) return null;

            const sortedData = [...specData.spectrum].sort((a, b) => a.wavelength - b.wavelength);

            let points;
            if (hasMultipleImages) {
              // Scale each spectrum to the global wavelength range with unit conversion
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
              // Original behavior for single image
              points = sortedData.map((point, index) => {
                const x = paddingX + (index / (sortedData.length - 1)) * graphWidth;
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
            
            // Only show RGB bands if we don't have pixels from multiple images AND not in dual-file mode
            if (!hasPixelsFromMultipleImages && !isDualFileMode) {
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
              {spectralDataArray.some(data => data.metadata?.wavelengthValues && data.metadata.wavelengthValues.length > 0)
                ? (hoveredPoint.wavelength < 10 
                    ? `${hoveredPoint.wavelength.toFixed(2)} μm`
                    : `${Math.round(hoveredPoint.wavelength)} nm`)
                : `Band ${hoveredPoint.band}`
              }
            </text>
          )}

          <text x={chartWidth / 2} y={chartHeight - 5} fontSize="10" textAnchor="middle">{xAxisLabel}</text>
          <text x={15} y={paddingY + (graphHeight / 2)} fontSize="10" textAnchor="middle"
            transform={`rotate(-90, 15, ${paddingY + (graphHeight / 2)})`}>Digital Number (DN)</text>
        </svg>

        <div className="mt-2">
          {spectralDataArray.map((specData, index) => (
            <div key={`legend-${index}`} className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center">
                <div
                  className="w-3 h-3 mr-1"
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
                    className="text-xs border rounded px-1"
                    autoFocus
                  />
                ) : (
                  <span
                    className="cursor-pointer hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(index);
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
  }, [spectralDataArray, shouldShowSpectralGraph, metadata, bands, hoveredPoint, cursorPosition, editingIndex, editingName, enableSharedSpectral, sharedContext]);


  return (
    <div className="relative">
      {/* Band Selection Controls */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <h4 className="font-semibold mb-2 text-sm">Band Selection</h4>
        {loadingBands && <p className="text-blue-600 mb-2 text-xs">Loading new bands...</p>}
        <form onSubmit={handleSubmit} className="flex gap-2 flex-wrap">
          <div className="flex items-center">
            <label className="mr-1 font-medium text-red-600 text-xs">R:</label>
            <input
              type="number"
              name="red"
              className="border rounded px-1 py-1 w-12 text-xs"
              value={inputBands.red}
              onChange={(e) => setInputBands({ ...inputBands, red: e.target.value })}
              min="1"
              max={metadata?.bands || 100}
              disabled={loadingBands}
            />
            <span className="ml-1 text-xs text-red-600">
              {formatWavelength(getWavelengthForBand(bands.red))}
            </span>
          </div>
          <div className="flex items-center">
            <label className="mr-1 font-medium text-green-600 text-xs">G:</label>
            <input
              type="number"
              name="green"
              className="border rounded px-1 py-1 w-12 text-xs"
              value={inputBands.green}
              onChange={(e) => setInputBands({ ...inputBands, green: e.target.value })}
              min="1"
              max={metadata?.bands || 100}
              disabled={loadingBands}
            />
            <span className="ml-1 text-xs text-green-600">
              {formatWavelength(getWavelengthForBand(bands.green))}
            </span>
          </div>
          <div className="flex items-center">
            <label className="mr-1 font-medium text-blue-600 text-xs">B:</label>
            <input
              type="number"
              name="blue"
              className="border rounded px-1 py-1 w-12 text-xs"
              value={inputBands.blue}
              onChange={(e) => setInputBands({ ...inputBands, blue: e.target.value })}
              min="1"
              max={metadata?.bands || 100}
              disabled={loadingBands}
            />
            <span className="ml-1 text-xs text-blue-600">
              {formatWavelength(getWavelengthForBand(bands.blue))}
            </span>
          </div>
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs"
            disabled={loadingBands}
          >
            Update
          </button>
        </form>
      </div>

      {/* Normalization controls */}
      <NormalizationControls />

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
      cursor: 'crosshair',
      maxWidth: '100%',
      height: 'auto',
      display: 'block'
    }} 
  />
</div>

      {/* Spectral graph popup - only show on main display */}
      {spectralGraph}
    </div>
  );
};

export default ImageRenderer;