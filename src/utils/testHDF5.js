// Simple test for HDF5 parsing functionality
import { parseHDF5, parseHDF5Bands } from './parseHDF5.js';

export const testHDF5Parsing = async (file) => {
  try {
    console.log('Testing HDF5 file parsing...');
    
    // Test metadata parsing
    const metadata = await parseHDF5(file);
    console.log('HDF5 metadata parsed successfully:', metadata);
    
    // Test band data parsing with first 3 bands
    const testBands = [1, 2, 3];
    const bandData = await parseHDF5Bands(file, metadata, testBands);
    console.log('HDF5 band data parsed successfully:', bandData.length, 'bands');
    
    return {
      success: true,
      metadata,
      bandData,
      loadedBands: testBands
    };
    
  } catch (error) {
    console.error('HDF5 parsing test failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};