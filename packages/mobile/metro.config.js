const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const config = {
  transformer: {
    babelTransformerPath: require.resolve("metro-react-native-babel-preset")
  },
  resolver: {
    sourceExts: ["js", "jsx", "ts", "tsx", "json"]
  }
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
