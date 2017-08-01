const path = require('path');
const webpack = require('webpack');

const HtmlWebpackPlugin = require('html-webpack-plugin');

const jsSourcePath = path.join(__dirname, './src');
const buildPath = path.join(__dirname, './public');

module.exports = {
    entry: './app.js',
    context : jsSourcePath,
    output: {
        path: buildPath,
        filename: 'app.js'
    },
    module: {
        rules : [
            {
                test: /\.(js|jsx)$/,
                exclude: /node_modules/,
                use: [
                    'babel-loader',
                ]
            }
        ]
    },
    resolve: {
        extensions: ['.webpack-loader.js', '.web-loader.js', '.loader.js', '.js', '.jsx'],
        modules: [
            path.resolve(__dirname, 'node_modules'),
            jsSourcePath,
        ],
    },
    plugins: [
        new webpack.optimize.OccurrenceOrderPlugin(),
        new webpack.HotModuleReplacementPlugin(),
        new webpack.NoEmitOnErrorsPlugin(),
        // Builds index.html from template
        new HtmlWebpackPlugin({
            template: path.join(buildPath, 'index.html'),
            path: buildPath,
            filename: 'index.html',
            minify: {
                collapseWhitespace: true,
                minifyCSS: true,
                minifyJS: true,
                removeComments: true,
                useShortDoctype: true,
            },
        })
    ]
};