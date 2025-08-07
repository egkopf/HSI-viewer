import { read as readmat } from 'mat-for-js';

// Parse MATLAB file and extract hierarchical structure
export async function parseMatStructure(file) {
  try {
    // Validate file
    if (!file || !file.arrayBuffer) {
      throw new Error('Invalid file object provided');
    }

    console.log('Reading MATLAB file:', file.name, 'Size:', file.size);
    
    const fileSizeMB = file.size / 1024 / 1024;
    const isLargeFile = file.size > 100 * 1024 * 1024; // 100MB threshold
    
    if (isLargeFile) {
      console.log(`Large MATLAB file detected (${fileSizeMB.toFixed(1)}MB).`);
    }
    
    // Log file extension for debugging
    const fileExtension = file.name.toLowerCase().split('.').pop();
    console.log(`File extension: .${fileExtension}`);

    // Read file as ArrayBuffer
    let fileBuffer;
    try {
      console.log('Reading MATLAB file...');
      fileBuffer = await file.arrayBuffer();
      console.log('File read successfully');
    } catch (bufferError) {
      console.error('Direct read failed:', bufferError.message);
      throw new Error(`Failed to read MATLAB file: ${bufferError.message}`);
    }
    
    if (fileBuffer.byteLength === 0) {
      throw new Error('File is empty');
    }

    // Check if this is a MATLAB v7.3 file (HDF5-based)
    const isMatV73 = isHDF5BasedMatFile(fileBuffer);
    if (isMatV73) {
      throw new Error('This appears to be a MATLAB v7.3 file (HDF5-based). These files use HDF5 format and should be processed using the HDF5 upload option instead.');
    }

    // Parse MATLAB file using mat4js
    let matData;
    try {
      console.log('Parsing MATLAB file with mat4js...');
      matData = readmat(fileBuffer);
      console.log('MATLAB file parsed successfully');
      
      // Debug: Log the structure of the parsed data
      console.log('MATLAB file contents:', Object.keys(matData));
      Object.keys(matData).forEach(key => {
        if (!key.startsWith('__')) {
          const value = matData[key];
          console.log(`Variable "${key}":`, {
            type: typeof value,
            isArray: Array.isArray(value),
            shape: Array.isArray(value) ? getArrayShape(value) : 'not array',
            firstFewElements: Array.isArray(value) ? value.slice(0, 5) : value
          });
        }
      });
    } catch (parseError) {
      console.error('MATLAB parsing error:', parseError);
      throw new Error(`Failed to parse MATLAB file: ${parseError.message}. This may be due to:\n1. Unsupported MATLAB file version\n2. Corrupted file\n3. MATLAB v7.3 format (use HDF5 parser instead)`);
    }
    
    // Extract file structure
    const structure = extractMatStructure(matData, file.name);
    
    // Add metadata about large file handling
    if (isLargeFile) {
      structure.isLargeFile = true;
      structure.fileSize = file.size;
    }
    
    return structure;
  } catch (error) {
    console.error('Error parsing MATLAB file structure:', error);
    throw error;
  }
}

// Check if file is MATLAB v7.3 (HDF5-based) format
function isHDF5BasedMatFile(arrayBuffer) {
  const view = new Uint8Array(arrayBuffer);
  
  // Check for HDF5 signature: "\x89HDF\r\n\x1a\n"
  if (view.length >= 8 && 
      view[0] === 0x89 && view[1] === 0x48 && view[2] === 0x44 && view[3] === 0x46 &&
      view[4] === 0x0D && view[5] === 0x0A && view[6] === 0x1A && view[7] === 0x0A) {
    return true;
  }
  
  return false;
}

// Extract hierarchical structure from MATLAB data
function extractMatStructure(matData, filename) {
  const structure = {
    type: 'matlab',
    name: 'root',
    path: '/',
    format: 'MATLAB Level 5 MAT-file',
    children: []
  };

  // Add variables section
  if (matData && typeof matData === 'object') {
    const variableNames = Object.keys(matData).filter(key => !key.startsWith('__')); // Filter out MATLAB metadata
    const variables = [];
    
    // Process each top-level variable
    variableNames.forEach(varName => {
      const variable = matData[varName];
      
      // If this is a struct/object, expand its fields
      if (variable && typeof variable === 'object' && !Array.isArray(variable)) {
        const fields = Object.keys(variable);
        console.log(`Expanding struct "${varName}" with fields:`, fields);
        
        fields.forEach(fieldName => {
          const fieldValue = variable[fieldName];
          const varInfo = analyzeMatVariable(fieldValue, fieldName);
          
          variables.push({
            type: 'variable',
            name: `${varName}.${fieldName}`,
            path: `/variables/${varName}.${fieldName}`,
            dimensions: varInfo.dimensions,
            shape: varInfo.shape,
            dataType: varInfo.dataType,
            size: varInfo.size,
            // Check if this could be wavelength or reflectance data
            isWavelengthCandidate: isWavelengthCandidate(varInfo, fieldName),
            isReflectanceCandidate: isReflectanceCandidate(varInfo, fieldName),
            // Store original data for loading
            _matData: fieldValue,
            _parentStruct: varName,
            _fieldName: fieldName
          });
        });
      } else {
        // Handle regular variables (arrays, scalars, etc.)
        const varInfo = analyzeMatVariable(variable, varName);
        
        variables.push({
          type: 'variable',
          name: varName,
          path: `/variables/${varName}`,
          dimensions: varInfo.dimensions,
          shape: varInfo.shape,
          dataType: varInfo.dataType,
          size: varInfo.size,
          // Check if this could be wavelength or reflectance data
          isWavelengthCandidate: isWavelengthCandidate(varInfo, varName),
          isReflectanceCandidate: isReflectanceCandidate(varInfo, varName),
          // Store original data for loading
          _matData: variable
        });
      }
    });
    
    if (variables.length > 0) {
      structure.children.push({
        type: 'variables',
        name: 'Variables',
        path: '/variables',
        children: variables
      });
    }
  }

  // Add MATLAB metadata if present
  const metadataKeys = Object.keys(matData).filter(key => key.startsWith('__'));
  if (metadataKeys.length > 0) {
    structure.children.push({
      type: 'metadata',
      name: 'MATLAB Metadata',
      path: '/metadata',
      children: metadataKeys.map(key => ({
        type: 'attribute',
        name: key,
        path: `/metadata/${key}`,
        value: matData[key],
        dataType: typeof matData[key]
      }))
    });
  }

  return structure;
}

// Analyze MATLAB variable to extract metadata
function analyzeMatVariable(variable, varName) {
  const info = {
    dataType: typeof variable,
    dimensions: [],
    shape: [],
    size: 0
  };

  if (Array.isArray(variable)) {
    // Handle array data
    info.dataType = 'array';
    info.shape = getArrayShape(variable);
    info.dimensions = info.shape.map((_, idx) => `dim_${idx}`);
    info.size = info.shape.reduce((acc, dim) => acc * dim, 1);
  } else if (variable && typeof variable === 'object') {
    // Handle struct or complex data
    if (variable.r !== undefined && variable.i !== undefined) {
      // Complex number
      info.dataType = 'complex';
      info.shape = [1];
      info.dimensions = ['scalar'];
      info.size = 1;
    } else {
      // Struct or other object
      info.dataType = 'struct';
      const fields = Object.keys(variable);
      info.shape = [fields.length];
      info.dimensions = ['fields'];
      info.size = fields.length;
    }
  } else {
    // Scalar value
    info.shape = [1];
    info.dimensions = ['scalar'];
    info.size = 1;
  }

  return info;
}

// Get shape of nested array
function getArrayShape(arr) {
  if (!Array.isArray(arr)) {
    return [];
  }
  
  const shape = [arr.length];
  
  if (arr.length > 0 && Array.isArray(arr[0])) {
    const subShape = getArrayShape(arr[0]);
    shape.push(...subShape);
  }
  
  return shape;
}

// Check if a variable could contain wavelength data
function isWavelengthCandidate(varInfo, varName) {
  const name = varName.toLowerCase();
  const wavelengthKeywords = ['wavelength', 'wavelengths', 'wl', 'lambda', 'frequency', 'wavenumber', 'bands'];
  
  // Check name
  if (wavelengthKeywords.some(keyword => name.includes(keyword))) {
    return true;
  }
  
  // Check if it's 1D and has reasonable size for wavelength data
  if (varInfo.shape.length === 1 && varInfo.size > 10 && varInfo.size < 10000) {
    return true;
  }
  
  return false;
}

// Check if a variable could contain reflectance/radiance data
function isReflectanceCandidate(varInfo, varName) {
  const name = varName.toLowerCase();
  const reflectanceKeywords = ['reflectance', 'radiance', 'data', 'cube', 'image', 'spectral', 'hyperspectral', 'hsi'];
  
  // Check name
  if (reflectanceKeywords.some(keyword => name.includes(keyword))) {
    return true;
  }
  
  // Check if it's 3D (likely hyperspectral cube)
  if (varInfo.shape.length === 3 && varInfo.size > 1000) {
    return true;
  }
  
  // Check if it's a large array that could be reshaped (some MATLAB files store flattened data)
  if (varInfo.shape.length === 1 && varInfo.size > 10000) {
    return true;
  }
  
  return false;
}

// Load data from a specific MATLAB variable
export async function loadMatVariable(file, variableName, options = {}) {
  try {
    // Validate inputs
    if (!file || !variableName) {
      throw new Error('File and variable name are required');
    }

    console.log(`Loading MATLAB variable: ${variableName} from ${file.name}`);
    
    const fileSizeMB = file.size / 1024 / 1024;
    const isLargeFile = file.size > 100 * 1024 * 1024;
    
    if (isLargeFile) {
      console.log(`Large file detected (${fileSizeMB.toFixed(1)}MB).`);
    }

    // Read and parse the file
    const fileBuffer = await file.arrayBuffer();
    
    // Check for v7.3 format
    if (isHDF5BasedMatFile(fileBuffer)) {
      throw new Error('MATLAB v7.3 files are not supported by this parser. Use HDF5 parser instead.');
    }
    
    const matData = readmat(fileBuffer);
    
    // Remove '/variables/' prefix if present
    const cleanVariableName = variableName.replace('/variables/', '');
    
    // Handle nested variables (e.g., "data.hsi" or "data.wavelength")
    let variable;
    if (cleanVariableName.includes('.')) {
      const parts = cleanVariableName.split('.');
      const parentName = parts[0];
      const fieldName = parts[1];
      
      if (!matData.hasOwnProperty(parentName)) {
        throw new Error(`Parent variable "${parentName}" not found in MATLAB file`);
      }
      
      const parentVar = matData[parentName];
      if (!parentVar || typeof parentVar !== 'object' || !parentVar.hasOwnProperty(fieldName)) {
        throw new Error(`Field "${fieldName}" not found in "${parentName}"`);
      }
      
      variable = parentVar[fieldName];
    } else {
      // Handle regular top-level variables
      if (!matData.hasOwnProperty(cleanVariableName)) {
        throw new Error(`Variable "${cleanVariableName}" not found in MATLAB file`);
      }
      
      variable = matData[cleanVariableName];
    }
    const varInfo = analyzeMatVariable(variable, cleanVariableName);
    
    // Convert MATLAB data to expected format
    let processedData;
    if (Array.isArray(variable)) {
      processedData = flattenMatArray(variable);
    } else {
      // For non-array data, wrap in array
      processedData = [variable];
    }
    
    return {
      data: processedData,
      variable: {
        name: cleanVariableName,
        shape: varInfo.shape,
        attributes: [] // MATLAB files don't have attributes in the same sense
      },
      shape: varInfo.shape,
      dimensions: varInfo.dimensions,
      attributes: []
    };
  } catch (error) {
    console.error(`Error loading MATLAB variable ${variableName}:`, error);
    throw error;
  }
}

// Flatten nested MATLAB array to typed array
function flattenMatArray(arr) {
  const flattened = [];
  
  function flatten(item) {
    if (Array.isArray(item)) {
      for (const subItem of item) {
        flatten(subItem);
      }
    } else {
      // Handle different data types
      if (typeof item === 'object' && item.r !== undefined && item.i !== undefined) {
        // Complex number - use real part for now
        flattened.push(item.r);
      } else if (typeof item === 'number') {
        flattened.push(item);
      } else {
        // Convert other types to number or use 0 as fallback
        const num = Number(item);
        flattened.push(isNaN(num) ? 0 : num);
      }
    }
  }
  
  flatten(arr);
  
  // Convert to appropriate typed array
  if (flattened.length > 0) {
    // Check if all values are integers in uint16 range
    const allIntegers = flattened.every(val => Number.isInteger(val) && val >= 0 && val <= 65535);
    if (allIntegers) {
      return new Uint16Array(flattened);
    } else {
      return new Float32Array(flattened);
    }
  }
  
  return new Float32Array([]);
}