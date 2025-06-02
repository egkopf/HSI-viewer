// Enhanced parseGeoTIFF.js with comprehensive wavelength detection and debugging
import { selectDefaultRGBBands } from './bandSelection.js';

export async function parseGeoTIFF(tiffFile) {
  const GeoTIFF = await import('geotiff');
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  
  const samples = image.getWidth();
  const lines = image.getHeight();
  const bands = image.getSamplesPerPixel();
  
  const sampleFormat = image.getSampleFormat();
  const bitsPerSample = image.getBitsPerSample();
  const dataType = getENVIDataType(sampleFormat[0], bitsPerSample[0]);
  
  console.log(`=== DEBUGGING WAVELENGTH DETECTION FOR ${tiffFile.name} ===`);
  console.log(`Bands: ${bands}, Format: ${sampleFormat}, Bits: ${bitsPerSample}`);
  
  // Enhanced wavelength extraction with detailed logging
  const wavelengthResult = await extractWavelengthDataWithDebug(image, tiff, bands, tiffFile.name);
  
  // Select default RGB bands based on detection results
  const defaultBands = wavelengthResult.hasRealWavelengths 
    ? selectBandsByWavelength(wavelengthResult.wavelengths)
    : selectGeoTIFFDefaultBands(bands);
  
  const metadata = {
    samples,
    lines,
    bands,
    dataType,
    interleave: 'bip',
    byteOrder: 0,
    isBigEndian: false,
    defaultBands,
    wavelengthValues: wavelengthResult.wavelengths,
    hasRealWavelengths: wavelengthResult.hasRealWavelengths,
    wavelengthSource: wavelengthResult.source,
    fileType: 'geotiff',
    tiffImage: image,
    geoTransform: await getGeoTransformSafely(image),
    projection: await getProjectionSafely(image)
  };
  
  return metadata;
}

// Comprehensive wavelength detection with detailed debugging
async function extractWavelengthDataWithDebug(image, tiff, bands, filename) {
  console.log(`\n--- Starting wavelength detection for ${filename} ---`);
  
  // Method 1: Complete metadata dump and analysis
  const result1 = await dumpAllMetadata(image, tiff);
  if (result1 && result1.wavelengths) {
    console.log(`✓ SUCCESS: Found wavelengths via metadata dump`);
    return result1;
  }
  
  // Method 2: File directory exhaustive search
  const result2 = await exhaustiveTagSearch(image);
  if (result2 && result2.wavelengths) {
    console.log(`✓ SUCCESS: Found wavelengths via tag search`);
    return result2;
  }
  
  // Method 3: Filename-based intelligent guessing - DISABLED
  // const result3 = await filenameBasedDetection(filename, bands);
  // if (result3 && result3.wavelengths) {
  //   console.log(`✓ SUCCESS: Inferred wavelengths from filename`);
  //   return result3;
  // }
  console.log(`\n3. FILENAME-BASED DETECTION: DISABLED (to prevent fake wavelengths)`);
  
  // Method 4: Band count heuristics - DISABLED
  // const result4 = await bandCountHeuristics(bands);
  // if (result4 && result4.wavelengths) {
  //   console.log(`✓ SUCCESS: Applied band count heuristics`);
  //   return result4;
  // }
  console.log(`\n4. BAND COUNT HEURISTICS: DISABLED (to prevent fake wavelengths)`);
  
  // Method 5: Raw binary metadata scanning
  const result5 = await scanRawMetadata(tiff);
  if (result5 && result5.wavelengths) {
    console.log(`✓ SUCCESS: Found wavelengths in raw metadata`);
    return result5;
  }
  
  console.log(`⚠ FAILED: No wavelength metadata detected`);
  return {
    wavelengths: null,
    hasRealWavelengths: false,
    source: 'none - exhaustive search failed'
  };
}

// Method 1: Complete metadata dump with pattern analysis
async function dumpAllMetadata(image, tiff) {
  console.log(`\n1. METADATA DUMP:`);
  
  try {
    // Get all available metadata
    const gdalMeta = image.getGDALMetadata?.() || {};
    const fileDirectory = image.getFileDirectory?.() || {};
    const imageDesc = image.getImageDescription?.() || '';
    
    console.log(`GDAL metadata keys:`, Object.keys(gdalMeta));
    console.log(`File directory keys:`, Object.keys(fileDirectory));
    console.log(`Image description length:`, imageDesc.length);
    
    // Print all metadata for manual inspection
    console.log(`\nFull GDAL metadata:`, JSON.stringify(gdalMeta, null, 2));
    console.log(`\nFull file directory:`, JSON.stringify(fileDirectory, null, 2));
    console.log(`\nImage description:`, imageDesc);
    
    // Look for any wavelength-related patterns in all text values
    const allTextValues = [
      ...Object.values(gdalMeta).filter(v => typeof v === 'string'),
      ...Object.values(fileDirectory).filter(v => typeof v === 'string'),
      imageDesc
    ].join(' ').toLowerCase();
    
    console.log(`\nSearching for wavelength patterns in combined text...`);
    
    // Extract any numbers that could be wavelengths
    const numberPatterns = allTextValues.match(/\b\d+\.?\d*\b/g) || [];
    const potentialWavelengths = numberPatterns
      .map(n => parseFloat(n))
      .filter(n => n >= 200 && n <= 50000) // Reasonable wavelength range
      .filter(n => n !== 2015 && n !== 2014 && n !== 2016) // Filter out years
      .slice(0, 20); // Limit to first 20 candidates
    
    console.log(`Potential wavelength numbers found:`, potentialWavelengths);
    
    // Check for specific wavelength fields with more patterns
    const wavelengthFields = [
      'wavelength', 'wavelengths', 'WAVELENGTH', 'WAVELENGTHS',
      'band_wavelength', 'spectral_wavelength', 'center_wavelength',
      'wl', 'WL', 'lambda', 'LAMBDA', 'freq', 'frequency',
      'Band_1_Wavelength', 'central_wavelength'
    ];
    
    for (const field of wavelengthFields) {
      if (gdalMeta[field]) {
        console.log(`Found field ${field}:`, gdalMeta[field]);
        const wavelengths = parseWavelengthString(gdalMeta[field]);
        if (wavelengths.length > 0) {
          return { wavelengths, source: `GDAL metadata field: ${field}` };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`Metadata dump failed:`, error.message);
    return null;
  }
}

// Method 2: Exhaustive TIFF tag search
async function exhaustiveTagSearch(image) {
  console.log(`\n2. EXHAUSTIVE TAG SEARCH:`);
  
  try {
    const fileDirectory = image.getFileDirectory();
    console.log(`Total tags in file directory:`, Object.keys(fileDirectory).length);
    
    // Search ALL tags, not just known ones
    const allTags = Object.entries(fileDirectory);
    console.log(`\nAll TIFF tags:`);
    
    for (const [tagKey, tagValue] of allTags) {
      console.log(`Tag ${tagKey}:`, typeof tagValue, Array.isArray(tagValue) ? `Array[${tagValue.length}]` : tagValue);
      
      // Check if this tag contains wavelength-like data
      if (Array.isArray(tagValue)) {
        // Check if it's a numerical array that could be wavelengths
        const isNumericArray = tagValue.every(v => typeof v === 'number');
        if (isNumericArray && tagValue.length >= 3 && tagValue.length <= 1000) {
          const inWavelengthRange = tagValue.every(v => v >= 200 && v <= 50000);
          if (inWavelengthRange) {
            console.log(`*** POTENTIAL WAVELENGTH ARRAY in tag ${tagKey}:`, tagValue);
            return { wavelengths: tagValue, source: `TIFF tag ${tagKey}` };
          }
        }
      } else if (typeof tagValue === 'string') {
        // Check if string contains wavelength data
        const wavelengths = parseWavelengthString(tagValue);
        if (wavelengths.length >= 3) {
          console.log(`*** POTENTIAL WAVELENGTH STRING in tag ${tagKey}:`, tagValue);
          return { wavelengths, source: `TIFF tag ${tagKey}` };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`Tag search failed:`, error.message);
    return null;
  }
}

// Method 3: Filename-based intelligent detection
async function filenameBasedDetection(filename, bands) {
  console.log(`\n3. FILENAME ANALYSIS:`);
  console.log(`Filename: ${filename}`);
  console.log(`Band count: ${bands}`);
  
  try {
    // Parse filename for satellite/sensor info
    const upperFilename = filename.toUpperCase();
    
    // DE2 MS4 suggests 4-band multispectral
    if (upperFilename.includes('DE2') && upperFilename.includes('MS4')) {
      console.log(`Detected DE2 MS4 - 4-band multispectral`);
      if (bands === 4) {
        const wavelengths = [480, 560, 660, 830]; // Standard RGBN
        return { 
          wavelengths, 
          source: 'DE2 MS4 filename pattern (4-band multispectral)' 
        };
      }
    }
    
    // Look for other sensor patterns
    const sensorPatterns = [
      { pattern: /MS\d+/, bands: 4, wavelengths: [480, 560, 660, 830] },
      { pattern: /LANDSAT|L8|LC08/, bands: 8, wavelengths: [443, 482, 561, 655, 865, 1609, 2201, 590] },
      { pattern: /SENTINEL|S2/, bands: 13, wavelengths: [443, 490, 560, 665, 705, 740, 783, 842, 945, 1375, 1610, 2190, 2190] },
      { pattern: /WORLDVIEW|WV/, bands: 8, wavelengths: [427, 478, 546, 608, 659, 724, 833, 949] }
    ];
    
    for (const sensor of sensorPatterns) {
      if (sensor.pattern.test(upperFilename) && bands <= sensor.wavelengths.length) {
        console.log(`Matched sensor pattern: ${sensor.pattern}`);
        return { 
          wavelengths: sensor.wavelengths.slice(0, bands), 
          source: `Filename sensor pattern: ${sensor.pattern}` 
        };
      }
    }
    
    return null;
  } catch (error) {
    console.log(`Filename detection failed:`, error.message);
    return null;
  }
}

// Method 4: Band count heuristics
async function bandCountHeuristics(bands) {
  console.log(`\n4. BAND COUNT HEURISTICS:`);
  
  try {
    const heuristics = {
      1: { wavelengths: [630], description: 'Single band (typically red or panchromatic)' },
      3: { wavelengths: [480, 560, 660], description: 'RGB' },
      4: { wavelengths: [480, 560, 660, 830], description: 'RGB + NIR' },
      8: { wavelengths: [427, 478, 546, 608, 659, 724, 833, 949], description: 'WorldView-style 8-band' },
      13: { wavelengths: [443, 490, 560, 665, 705, 740, 783, 842, 945, 1375, 1610, 2190, 2190], description: 'Sentinel-2 style' }
    };
    
    if (heuristics[bands]) {
      console.log(`Applied heuristic for ${bands} bands: ${heuristics[bands].description}`);
      return { 
        wavelengths: heuristics[bands].wavelengths, 
        source: `Band count heuristic (${bands} bands - ${heuristics[bands].description})` 
      };
    }
    
    return null;
  } catch (error) {
    console.log(`Band count heuristics failed:`, error.message);
    return null;
  }
}

// Method 5: Raw binary metadata scanning
async function scanRawMetadata(tiff) {
  console.log(`\n5. RAW METADATA SCANNING:`);
  
  try {
    // This is experimental - try to access raw TIFF data
    const images = await tiff.getImageCount();
    console.log(`Total images in TIFF: ${images}`);
    
    // Try to get the first image's raw data structure
    const firstImage = await tiff.getImage(0);
    
    // Look for any hidden or embedded metadata
    if (firstImage.ifd) {
      console.log(`IFD structure:`, Object.keys(firstImage.ifd));
      
      // Search IFD for any numeric arrays
      for (const [key, value] of Object.entries(firstImage.ifd)) {
        if (Array.isArray(value) && value.length >= 3 && value.length <= 1000) {
          const isNumeric = value.every(v => typeof v === 'number');
          if (isNumeric) {
            const couldBeWavelengths = value.every(v => v >= 200 && v <= 50000);
            if (couldBeWavelengths) {
              console.log(`*** FOUND POTENTIAL WAVELENGTHS in IFD ${key}:`, value);
              return { wavelengths: value, source: `IFD field ${key}` };
            }
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`Raw metadata scan failed:`, error.message);
    return null;
  }
}

// Enhanced wavelength string parser
function parseWavelengthString(wavelengthStr) {
  if (typeof wavelengthStr !== 'string') return [];
  
  console.log(`Parsing wavelength string: "${wavelengthStr}"`);
  
  // Remove common delimiters and brackets
  let cleaned = wavelengthStr.replace(/[{}[\]()]/g, '').trim();
  
  // Try different separators
  const separators = [',', ' ', '\t', ';', '|', '\n', '\r'];
  
  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      const parts = cleaned.split(sep)
        .map(w => w.trim())
        .map(w => parseFloat(w))
        .filter(w => !isNaN(w) && w > 0 && w >= 200 && w <= 50000);
      
      if (parts.length >= 3) {
        console.log(`Successfully parsed ${parts.length} wavelengths with separator '${sep}':`, parts);
        return parts;
      }
    }
  }
  
  // Try regex patterns for common wavelength formats
  const patterns = [
    /(\d+\.?\d*)\s*nm/gi,
    /(\d+\.?\d*)\s*μm/gi,
    /(\d+\.?\d*)\s*um/gi,
    /(\d+\.?\d*)/g
  ];
  
  for (const pattern of patterns) {
    const matches = wavelengthStr.match(pattern);
    if (matches && matches.length >= 3) {
      const wavelengths = matches
        .map(m => parseFloat(m.replace(/[^\d.]/g, '')))
        .filter(w => !isNaN(w) && w >= 200 && w <= 50000);
      
      if (wavelengths.length >= 3) {
        console.log(`Regex pattern found ${wavelengths.length} wavelengths:`, wavelengths);
        return wavelengths;
      }
    }
  }
  
  return [];
}

// Validation function
function validateWavelengths(wavelengths) {
  if (!Array.isArray(wavelengths) || wavelengths.length === 0) return false;
  
  console.log(`Validating wavelengths:`, wavelengths);
  
  // Check all values are numbers
  if (!wavelengths.every(w => typeof w === 'number' && !isNaN(w))) {
    console.log(`Validation failed: not all numbers`);
    return false;
  }
  
  // Check reasonable range
  const allInRange = wavelengths.every(w => w >= 200 && w <= 50000);
  if (!allInRange) {
    console.log(`Validation failed: values out of range`);
    return false;
  }
  
  // Check for reasonable progression (mostly increasing)
  let increasingCount = 0;
  for (let i = 1; i < wavelengths.length; i++) {
    if (wavelengths[i] >= wavelengths[i-1]) increasingCount++;
  }
  
  const progressionRatio = increasingCount / (wavelengths.length - 1);
  console.log(`Progression ratio (should be > 0.6): ${progressionRatio}`);
  
  return progressionRatio >= 0.6;
}

// Smart band selection using real wavelengths
function selectBandsByWavelength(wavelengths) {
  console.log(`Selecting RGB bands from wavelengths:`, wavelengths);
  
  const targets = wavelengths[0] > 10 
    ? { red: 650, green: 550, blue: 450 }    // nanometers
    : { red: 0.65, green: 0.55, blue: 0.45 }; // micrometers
  
  const redBand = findClosestBand(wavelengths, targets.red);
  const greenBand = findClosestBand(wavelengths, targets.green);
  const blueBand = findClosestBand(wavelengths, targets.blue);
  
  console.log(`Selected RGB: R=${redBand}(${wavelengths[redBand-1]}), G=${greenBand}(${wavelengths[greenBand-1]}), B=${blueBand}(${wavelengths[blueBand-1]})`);
  
  return [redBand, greenBand, blueBand];
}

function findClosestBand(wavelengths, target) {
  let closestIndex = 0;
  let minDifference = Math.abs(wavelengths[0] - target);
  
  for (let i = 1; i < wavelengths.length; i++) {
    const difference = Math.abs(wavelengths[i] - target);
    if (difference < minDifference) {
      minDifference = difference;
      closestIndex = i;
    }
  }
  
  return closestIndex + 1;
}

// Helper functions (same as before)
function getENVIDataType(sampleFormat, bitsPerSample) {
  if (sampleFormat === 1) {
    return bitsPerSample === 16 ? 12 : 1;
  } else if (sampleFormat === 2) {
    return bitsPerSample === 16 ? 2 : 1;
  } else if (sampleFormat === 3) {
    return bitsPerSample === 32 ? 4 : 5;
  }
  return 12;
}

async function getGeoTransformSafely(image) {
  try {
    return image.getGeoTransform?.() || image.getModelTransformation?.() || null;
  } catch (error) {
    return null;
  }
}

async function getProjectionSafely(image) {
  try {
    return image.getGeoKeys?.() || image.getProjection?.() || null;
  } catch (error) {
    return null;
  }
}

function selectGeoTIFFDefaultBands(totalBands) {
  if (totalBands >= 3) {
    return [1, 2, 3];
  } else if (totalBands === 2) {
    return [1, 2, 1];
  } else {
    return [1, 1, 1];
  }
}

// Export functions remain the same
export async function parseGeoTIFFBands(tiffFile, metadata, bandNumbers) {
  const GeoTIFF = await import('geotiff');
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage(0);
  
  const { samples, lines } = metadata;
  const validBandNumbers = bandNumbers.map(band =>
    Math.max(1, Math.min(metadata.bands, Math.floor(band) || 1))
  );
  
  const rasters = await image.readRasters({
    samples: validBandNumbers.map(b => b - 1),
    interleave: false,
    width: image.getWidth(),
    height: image.getHeight()
  });
  
  const bandData = new Array(validBandNumbers.length);
  
  for (let bandIdx = 0; bandIdx < validBandNumbers.length; bandIdx++) {
    bandData[bandIdx] = new Array(lines);
    const bandRaster = rasters[bandIdx];
    
    for (let line = 0; line < lines; line++) {
      const lineStart = line * samples;
      bandData[bandIdx][line] = bandRaster.subarray(lineStart, lineStart + samples);
    }
  }
  
  return bandData;
}

export async function extractGeoTIFFPixelSpectrum(tiffFile, metadata, x, y) {
  const GeoTIFF = await import('geotiff');
  const arrayBuffer = await tiffFile.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  
  const { samples, lines, bands, wavelengthValues, hasRealWavelengths } = metadata;
  
  if (x < 0 || x >= samples || y < 0 || y >= lines) {
    throw new Error(`Pixel coordinates (${x}, ${y}) out of bounds`);
  }
  
  const pixelData = await image.readRasters({
    window: [x, y, x + 1, y + 1],
    width: 1,
    height: 1
  });
  
  const spectrum = [];
  for (let band = 0; band < bands; band++) {
    const value = pixelData[band][0];
    
    const wavelength = hasRealWavelengths && wavelengthValues 
      ? wavelengthValues[band] 
      : band + 1;
    
    spectrum.push({
      band: band + 1,
      wavelength,
      value: value > 55535 ? 0 : value
    });
  }
  
  return spectrum;
}