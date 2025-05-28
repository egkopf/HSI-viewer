// utils/bandSelection.js

/**
 * Intelligently selects RGB bands based on wavelength data or band count
 * @param {Object} metadata - Parsed HDR metadata
 * @returns {Array} Array of three band numbers [red, green, blue]
 */
export function selectDefaultRGBBands(metadata) {
  const totalBands = parseInt(metadata.bands, 10) || 1;
  
  // If we have wavelength data, use it for intelligent selection
  if (metadata.wavelengthValues && metadata.wavelengthValues.length === totalBands) {
    return selectBandsByWavelength(metadata.wavelengthValues);
  }
  
  // Fallback to percentage-based selection for different sensor types
  return selectBandsByPercentage(totalBands);
}

/**
 * Select bands based on actual wavelength values
 * @param {Array} wavelengths - Array of wavelength values
 * @returns {Array} [red, green, blue] band numbers (1-based)
 */
function selectBandsByWavelength(wavelengths) {
  // Target wavelengths for RGB (in nanometers, convert from micrometers if needed)
  const targetRed = wavelengths[0] > 10 ? 650 : 0.65;    // 650nm or 0.65μm
  const targetGreen = wavelengths[0] > 10 ? 550 : 0.55;  // 550nm or 0.55μm  
  const targetBlue = wavelengths[0] > 10 ? 450 : 0.45;   // 450nm or 0.45μm
  
  const redBand = findClosestBand(wavelengths, targetRed);
  const greenBand = findClosestBand(wavelengths, targetGreen);
  const blueBand = findClosestBand(wavelengths, targetBlue);
  
  console.log(`Selected RGB bands by wavelength: R=${redBand} (${wavelengths[redBand-1]}), G=${greenBand} (${wavelengths[greenBand-1]}), B=${blueBand} (${wavelengths[blueBand-1]})`);
  
  return [redBand, greenBand, blueBand];
}

/**
 * Find the band number closest to a target wavelength
 * @param {Array} wavelengths - Array of wavelength values
 * @param {number} target - Target wavelength
 * @returns {number} Band number (1-based)
 */
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
  
  return closestIndex + 1; // Convert to 1-based indexing
}

/**
 * Select bands based on percentage positions when no wavelength data is available
 * @param {number} totalBands - Total number of bands
 * @returns {Array} [red, green, blue] band numbers (1-based)
 */
function selectBandsByPercentage(totalBands) {
  // Use percentages that work well across different sensor types
  const redPercent = 0.75;   // 75% through the spectrum (typically near-infrared/red)
  const greenPercent = 0.45; // 45% through the spectrum (typically green/yellow)
  const bluePercent = 0.15;  // 15% through the spectrum (typically blue/violet)
  
  const redBand = Math.max(1, Math.min(totalBands, Math.round(totalBands * redPercent)));
  const greenBand = Math.max(1, Math.min(totalBands, Math.round(totalBands * greenPercent)));
  const blueBand = Math.max(1, Math.min(totalBands, Math.round(totalBands * bluePercent)));
  
  console.log(`Selected RGB bands by percentage: R=${redBand}, G=${greenBand}, B=${blueBand} (of ${totalBands} total)`);
  
  return [redBand, greenBand, blueBand];
}

/**
 * Validate and clamp band numbers to valid range
 * @param {Array} bandNumbers - Array of band numbers
 * @param {number} maxBands - Maximum valid band number
 * @returns {Array} Validated band numbers
 */
export function validateBandNumbers(bandNumbers, maxBands) {
  return bandNumbers.map(band => 
    Math.max(1, Math.min(maxBands, Math.floor(band) || 1))
  );
}