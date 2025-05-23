import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { parseSpecificBands, extractPixelSpectrum } from '../utils/parseHyperspectral';

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
};

const ImageRenderer = ({ bandData, metadata, loadedBands, dataFile }) => {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);

  // Initialize bands from metadata or loadedBands
  const [bands, setBands] = useState(() => {

  if (loadedBands?.length >= 3) {
    return {
      red: loadedBands[0],
      green: loadedBands[1], 
      blue: loadedBands[2]
    };
  }
  // Simple fallback for initial render
  return { red: 1, green: 1, blue: 1 };
  });

  // Separate input state for form values (what user types) - keep as strings to allow empty/partial input
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

  const [spectralDataArray, setSpectralDataArray] = useState([]);
  const [showSpectralGraph, setShowSpectralGraph] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [cursorPosition, setCursorPosition] = useState(null);

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

      const newBandData = await parseSpecificBands(dataFile, metadata, newBandNumbers);

      setCurrentBandData(newBandData);
      setCurrentLoadedBands(newBandNumbers);
      setLoadingBands(false);
    } catch (error) {
      console.error('Error loading bands:', error);
      setLoadingBands(false);
      alert('Failed to load bands: ' + error.message);
    }
  }, [dataFile, metadata, currentLoadedBands]);

  // Render the image data to the canvas - OPTIMIZED VERSION
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
    const data = imageData.data; // Direct reference to avoid repeated lookups

    console.log(`Rendering bands R:${bands.red}, G:${bands.green}, B:${bands.blue}`);

    // Optimized band statistics calculation
    const calculateBandStats = (bandIndex) => {
      if (!currentBandData[bandIndex]) return { min: 0, max: 65535 };

      const values = [];
      const ignoreValue = parseFloat(metadata["data ignore value"] || -1);
      const skipInterval = 5; // Sample every 5th pixel instead of random

      for (let line = 0; line < lines; line += skipInterval) {
        const lineData = currentBandData[bandIndex][line];
        if (!lineData) continue;
        
        for (let sample = 0; sample < samples; sample += skipInterval) {
          const value = lineData[sample];
          if (value !== undefined && value !== ignoreValue && value <= 55535) {
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
    const ignoreValue = parseFloat(metadata["data ignore value"] || -1);

    // Pre-allocate band data references
    const redBand = currentBandData[0];
    const greenBand = currentBandData[1];
    const blueBand = currentBandData[2];

    // Fast normalization function (inline for better performance)
    const fastNormalize = (value, min, range) => {
      if (value > 55535 || range <= 0) return 0;
      let normalized = (value - min) / range;
      normalized = Math.max(0, Math.min(1, normalized));
      return Math.floor(Math.pow(normalized, gamma) * 255);
    };

    // Process pixels in chunks for better cache performance
    let dataIndex = 0;
    
    for (let line = 0; line < lines; line++) {
      const redLine = redBand[line];
      const greenLine = greenBand[line];
      const blueLine = blueBand[line];
      
      // Skip line if any band data is missing
      if (!redLine || !greenLine || !blueLine) {
        // Fill with black pixels
        for (let sample = 0; sample < samples; sample++) {
          data[dataIndex++] = 0; // R
          data[dataIndex++] = 0; // G
          data[dataIndex++] = 0; // B
          data[dataIndex++] = 255; // A
        }
        continue;
      }

      const isEdgeLine = (line === 0 || line === lines - 1);

      // Process samples in batches for better performance
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

        const isIgnored = (redValue === ignoreValue || greenValue === ignoreValue || blueValue === ignoreValue);

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
  }, [currentBandData, metadata, bands, normalizationSettings]);

  // Pixel click handler - now reads spectrum from file
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
      const pixelSpectrum = await extractPixelSpectrum(dataFile, metadata, x, y);

      const validValues = pixelSpectrum.filter(point => point.value > 0);

      if (validValues.length === 0 || validValues.length < pixelSpectrum.length * 0.1) {
        console.log(`Pixel (${x}, ${y}) has no valid spectral data - ignoring`);
        return; // Don't add to spectral graph
      }

      const randomColor = `rgb(${Math.floor(Math.random() * 200)}, ${Math.floor(Math.random() * 200)}, ${Math.floor(Math.random() * 200)})`;

      const newSpectralData = {
        spectrum: pixelSpectrum,
        position: { x, y },
        color: randomColor
      };

      setSpectralDataArray(prevArray => [...prevArray, newSpectralData]);
      setShowSpectralGraph(true);
    } catch (error) {
      console.error('Error extracting pixel spectrum:', error);
      alert('Failed to extract spectral data: ' + error.message);
    }
  }, [dataFile, metadata]);

  // Set up event listeners
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

      // Check if all RGB values are 0 or negative (ignore pixel, edge pixel, or bad data)
      const redValue = currentBandData[0]?.[y]?.[x] || 0;
      const greenValue = currentBandData[1]?.[y]?.[x] || 0;
      const blueValue = currentBandData[2]?.[y]?.[x] || 0;

      if (redValue <= 0 && greenValue <= 0 && blueValue <= 0) {
        console.log(`Clicked on pixel (${x}, ${y}) with invalid values (${redValue}, ${greenValue}, ${blueValue}) - ignoring`);
        return; // Do nothing for invalid pixels
      }

      // Proceed with original handlePixelClick logic
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
    setSpectralDataArray([]);
    setShowSpectralGraph(false);
  };

  // Handle form submission for band selection
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Parse the string values to numbers
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
      setBands(newBands); // Update the actual bands
      await loadNewBands(newBands);
    } else {
      alert(`Please enter valid band numbers between 1 and ${maxBand}`);
    }
  };

  // Calculate spectral graph popup position
  const calculatePopupPosition = useCallback(() => {
    // const graphWidth = 320;
    const graphHeight = 240;
    const left = 20;
    const top = window.innerHeight - graphHeight - 130;

    return {
      position: 'fixed',
      left: left + 'px',
      top: top + 'px',
      zIndex: 1000
    };
  }, []);

  // Helper to get wavelength for a band
  const getWavelengthForBand = useCallback((bandNumber) => {
    if (!metadata || !metadata.wavelengthValues ||
      bandNumber < 1 || bandNumber > metadata.bands) {
      return null;
    }
    return metadata.wavelengthValues[bandNumber - 1];
  }, [metadata]);

  // Format wavelength value for display
  const formatWavelength = useCallback((wavelength) => {
    if (wavelength === null || wavelength === undefined) return '';

    if (wavelength < 10) {
      return `${wavelength.toFixed(3)} μm`;
    }
    return `${Math.round(wavelength)} nm`;
  }, []);

  // Normalization Controls component
  const NormalizationControls = () => (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
      <h4 className="font-semibold mb-2">Image Enhancement Controls</h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Lower Cutoff ({Math.round(normalizationSettings.lowerPercentile * 100)}%)
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
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Upper Cutoff ({Math.round(normalizationSettings.upperPercentile * 100)}%)
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
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
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
            className="w-full"
          />
        </div>
      </div>
    </div>
  );

  // Memoized spectral graph rendering (same as before but using file-extracted data)
  const spectralGraph = useMemo(() => {
    if (!showSpectralGraph || spectralDataArray.length === 0) {
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

    const bandPositions = {};
    if (metadata.wavelengthValues) {
      const wavelengths = metadata.wavelengthValues;
      const minWavelength = Math.min(...wavelengths);
      const maxWavelength = Math.max(...wavelengths);
      const range = maxWavelength - minWavelength;

      bandPositions.red = (wavelengths[bands.red - 1] - minWavelength) / range;
      bandPositions.green = (wavelengths[bands.green - 1] - minWavelength) / range;
      bandPositions.blue = (wavelengths[bands.blue - 1] - minWavelength) / range;
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

    const firstSpectrum = spectralDataArray[0]?.spectrum || [];
    const xTickCount = Math.min(9, firstSpectrum.length);
    const xTicks = [];

    let xAxisLabel = "Band"; // Default value

    if (firstSpectrum.length > 0) {
      const wavelengthValues = firstSpectrum.map(d => d.wavelength);
      const minWavelength = Math.min(...wavelengthValues);
      const maxWavelength = Math.max(...wavelengthValues);
      const hasRealWavelengthData = metadata.wavelengthValues && metadata.wavelengthValues.length > 0;

      if (hasRealWavelengthData) {
        for (let i = 0; i < xTickCount; i++) {
          const wavelengthValue = minWavelength + (i / (xTickCount - 1)) * (maxWavelength - minWavelength);
          const xPosition = paddingX + (i / (xTickCount - 1)) * graphWidth;

          // Format to keep under 4 digits total
          let formattedValue;
          if (wavelengthValue >= 100) {
            formattedValue = Math.round(wavelengthValue).toString(); // "123"
          } else if (wavelengthValue >= 10) {
            formattedValue = wavelengthValue.toFixed(1); // "12.3"
          } else if (wavelengthValue >= 1) {
            formattedValue = wavelengthValue.toFixed(2); // "1.23"
          } else {
            formattedValue = wavelengthValue.toFixed(3).substring(0, 4); // "0.12" from "0.123"
          }

          xTicks.push({
            x: xPosition,
            value: formattedValue
          });
        }
        // Set wavelength label with proper units
        xAxisLabel = maxWavelength < 10 ? "Wavelength (μm)" : "Wavelength (nm)";
      } else {
        for (let i = 0; i < xTickCount; i++) {
          const bandNum = Math.floor(1 + i * (firstSpectrum.length - 1) / (xTickCount - 1));
          const xPosition = paddingX + (i / (xTickCount - 1)) * graphWidth;
          xTicks.push({
            x: xPosition,
            value: bandNum
          });
        }
        // Keep default "Band" label
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
      const newArray = [...spectralDataArray];
      newArray.splice(index, 1);
      setSpectralDataArray(newArray);
    };

    const handleMouseMove = (e) => {
      const svgRect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - svgRect.left;

      if (x >= paddingX && x <= paddingX + graphWidth) {
        setCursorPosition(x);
        const relativeX = (x - paddingX) / graphWidth;

        spectralDataArray.forEach((specData) => {
          if (!specData.spectrum) return;

          const sortedData = [...specData.spectrum].sort((a, b) => a.wavelength - b.wavelength);
          const dataIndex = Math.floor(relativeX * (sortedData.length - 1));

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
        });

        setHoveredPoint({ x, values: spectralDataArray.map(d => d.hoverPoint) });
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
      <div className="spectral-graph fixed bg-white border border-gray-300 shadow-lg p-4" style={calculatePopupPosition()}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold">
            Spectral Profiles ({spectralDataArray.length} pixels)
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

            const points = sortedData.map((point, index) => {
              const x = paddingX + (index / (sortedData.length - 1)) * graphWidth;
              const y = paddingY + graphHeight - ((point.value - minValue) / (maxValue - minValue) * graphHeight);
              return `${x},${y}`;
            }).join(' ');

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

          <line x1={paddingX + (bandPositions.red * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.red * graphWidth)}
            y2={paddingY + graphHeight} stroke="rgba(255, 0, 0, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
          <line x1={paddingX + (bandPositions.green * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.green * graphWidth)}
            y2={paddingY + graphHeight} stroke="rgba(0, 180, 0, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
          <line x1={paddingX + (bandPositions.blue * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.blue * graphWidth)}
            y2={paddingY + graphHeight} stroke="rgba(0, 0, 255, 0.7)" strokeWidth="1" strokeDasharray="4,2" />

          {cursorPosition && (
            <line x1={cursorPosition} y1={paddingY} x2={cursorPosition} y2={paddingY + graphHeight} stroke="#999" strokeWidth="1" strokeDasharray="2,2" />
          )}

          <text x={chartWidth / 2} y={chartHeight - 5} fontSize="10" textAnchor="middle">{xAxisLabel}</text>
          <text x={15} y={paddingY + (graphHeight / 2)} fontSize="10" textAnchor="middle"
            transform={`rotate(-90, 15, ${paddingY + (graphHeight / 2)})`}>Digital Number (DN)</text>
        </svg>

        <div className="mt-2 max-h-20 overflow-y-auto">
          {spectralDataArray.map((specData, index) => (
            <div key={`legend-${index}`} className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center">
                <div
                  className="w-3 h-3 mr-1"
                  style={{ backgroundColor: specData.color }}
                ></div>
                <span>
                  Pixel ({specData.position.x}, {specData.position.y})
                  {specData.hoverPoint && ` - ${Math.round(specData.hoverPoint.value)}`}
                </span>
              </div>
              <button
                className="text-gray-500 hover:text-red-500 ml-2"
                onClick={() => removeSpectrum(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }, [spectralDataArray, showSpectralGraph, metadata, bands, calculatePopupPosition, hoveredPoint, cursorPosition]);

  return (
    <div className="relative">
      {/* Band Selection Controls */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <h4 className="font-semibold mb-2">Band Selection</h4>
        {loadingBands && <p className="text-blue-600 mb-2">Loading new bands...</p>}
        <form onSubmit={handleSubmit} className="flex gap-4">
          <div className="flex items-center">
            <label className="mr-2 font-medium text-red-600">R:</label>
            <input
              type="number"
              name="red"
              className="border rounded px-2 py-1 w-16"
              value={inputBands.red}
              onChange={(e) => setInputBands({ ...inputBands, red: e.target.value })}
              min="1"
              max={metadata?.bands || 100}
              disabled={loadingBands}
            />
            <span className="ml-2 text-sm text-red-600">
              {formatWavelength(getWavelengthForBand(bands.red))}
            </span>
          </div>
          <div className="flex items-center">
            <label className="mr-2 font-medium text-green-600">G:</label>
            <input
              type="number"
              name="green"
              className="border rounded px-2 py-1 w-16"
              value={inputBands.green}
              onChange={(e) => setInputBands({ ...inputBands, green: e.target.value })}
              min="1"
              max={metadata?.bands || 100}
              disabled={loadingBands}
            />
            <span className="ml-2 text-sm text-green-600">
              {formatWavelength(getWavelengthForBand(bands.green))}
            </span>
          </div>
          <div className="flex items-center">
            <label className="mr-2 font-medium text-blue-600">B:</label>
            <input
              type="number"
              name="blue"
              className="border rounded px-2 py-1 w-16"
              value={inputBands.blue}
              onChange={(e) => setInputBands({ ...inputBands, blue: e.target.value })}
              min="1"
              max={metadata?.bands || 100}
              disabled={loadingBands}
            />
            <span className="ml-2 text-sm text-blue-600">
              {formatWavelength(getWavelengthForBand(bands.blue))}
            </span>
          </div>
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded"
            disabled={loadingBands}
          >

            Update
          </button>
        </form>
      </div>

      {/* Normalization controls */}
      <NormalizationControls />

      <canvas ref={canvasRef} style={{ cursor: 'crosshair' }} />

      {/* Spectral graph popup */}
      {spectralGraph}
    </div>
  );
};

export default ImageRenderer;