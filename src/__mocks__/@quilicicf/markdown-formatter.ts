// Mock for @quilicicf/markdown-formatter to avoid ESM import issues in tests

interface MockVFile {
  toString: () => string;
}

export const formatFromString = async (content: string): Promise<MockVFile> => {
  // Return a mock VFile-like object
  return {
    toString: () => content,
  };
};

export const formatFromFile = formatFromString;
