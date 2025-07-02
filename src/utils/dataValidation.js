/**
 * Validates if a pixel value is valid for hyperspectral data
 * @param {number} value - The pixel value to validate
 * @param {Object} metadata - Parsed HDR metadata
 * @returns {boolean} True if valid, false if should be ignored
 */
export function isValidPixelValue(value, metadata) {

  const ignoreValue = parseFloat(metadata["data ignore value"]);
  if (!isNaN(ignoreValue) && value === ignoreValue) {
    return false;
  }
  
  if (value < 0 || value === 0) return false;
  
  const dataType = metadata.dataType || 12;
  if (dataType === 12 || dataType === 2) { // 16-bit data
    // catches corrupted sensor data
    if (value > 55000) return false;
    
    // Max uint16 value often used as sentinel
    if (value === 65535) return false;
  }
  
  return true;
}