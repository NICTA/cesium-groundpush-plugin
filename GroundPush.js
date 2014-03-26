/**
 * The GroundPush Object that initialises Cesium to allow for push a defined extent.
 * @param {Cesium} Cesium  The result of Cesium.js
 * @param {Object} options  The options include:
 *
 * options.pushDepth  The intial depth of the push region.
 * options.pushExtent  The extent of the region to be pushed.
 * options.pushBaseTint  A Cesium.Cartesian3 Object representing the colour tint of the base of the pushed region. 
 * options.pushSidesTint  A Cesium.Cartesian3 Object representing the colour tint of the base of the pushed region.
 *
 * Make changes to the pushDepth by accessing the gp.pushDepth property.
 */
var GroundPush = function(Cesium, options) {
    'use strict';
    // Defines the fraction of the extent width will be the push blend value.
    this._pushBlendFraction = 0.001;
    
    if (typeof Cesium === undefined) {
        throw 'Cesium must be defined for this plugin to work.';
    }
    if (typeof Cesium.defined === undefined || !Cesium.defined(Cesium.HeightmapTerrainData)) {
        throw 'Version of Cesium is too old, please upgrade Cesium.';
    }
    this.Cesium = Cesium;

    this.pushDepth = Cesium.defaultValue(options.pushDepth, 0.0);

    this.setInnerExtent(Cesium.defaultValue(options.pushExtent, new Cesium.Extent(0.0, 0.0, 0.0, 0.0)));
    
    this.pushBaseTint = Cesium.defaultValue(options.pushBaseTint, new Cesium.Cartesian3(1.0, 1.0, 1.0));
    this.pushSidesTint = Cesium.defaultValue(options.pushSidesTint, new Cesium.Cartesian3(1.0, 1.0, 1.0));
    
    var that = this;
    

    /**
     * Modifying the passed in Cesium to allow for ground pushing...
     */

    // Wrapper for the createMesh function, modifies the vertices to provide the extent.
    var newCreateMesh = function(tilingScheme, x, y, level) {
        var terrainMesh = this._oldCreateMesh(tilingScheme, x, y, level);

        var ellipsoid = tilingScheme.ellipsoid;

        var extent = tilingScheme.tileXYToExtent(x, y, level);
        
        // Check if the current tile contains any part of the extent
        var tileContainsExtent = !extent.intersectWith(that._outerExtent).isEmpty() || !extent.intersectWith(that._innerExtent).isEmpty();
        
        if (!Cesium.defined(terrainMesh)) {
            // Postponed
            return undefined;
        }
        
        return Cesium.when(terrainMesh, function(result) {
            if (Cesium.defined(result) && tileContainsExtent) {
                var slicedResult = insertPushVertices({
                    innerExtent : that._innerExtent,
                    outerExtent : that._outerExtent,
                    vertices : result.vertices,
                    indices : result.indices,
                    tileExtent : extent,
                    ellipsoid : ellipsoid,
                    center : result.center
                });
                result.vertices = new Float32Array(slicedResult.vertices);
                result.indices = new Uint16Array(slicedResult.indices);
            }
            return result;
        });
    };

    // Apply the new createMesh function to both terrain types.
    Cesium.HeightmapTerrainData.prototype._oldCreateMesh = Cesium.HeightmapTerrainData.prototype.createMesh;
    Cesium.HeightmapTerrainData.prototype.createMesh = newCreateMesh;
    Cesium.QuantizedMeshTerrainData.prototype._oldCreateMesh = Cesium.QuantizedMeshTerrainData.prototype.createMesh;
    Cesium.QuantizedMeshTerrainData.prototype.createMesh = newCreateMesh;

    
    // Replace the original Cesium CentralBodySurfaceShaderSet.
    Cesium.CentralBodySurfaceShaderSet.prototype = GroundPushCentralBodySurfaceShaderSet.prototype;
    
    // Add the uniforms to the central body 
    Cesium.CentralBody.prototype._oldUpdate = Cesium.CentralBody.prototype.update;
    Cesium.CentralBody.prototype.update = function(context, frameState, commandList) {
        // Call the original constructor.
        if (!Cesium.defined(this._drawUniforms.u_pushDepth)) {
            // Add extra draw uniforms.
            this._drawUniforms.u_pushDepth = function() {
                return that.pushDepth;
            };
            this._drawUniforms.u_pushExtent = function() {
                var extent = that._innerExtent;
                return new Cesium.Cartesian4(extent.west, extent.south, extent.east, extent.north);
            };
            this._drawUniforms.u_pushBlend = function() {
                return that.pushBlend;
            };
            this._drawUniforms.u_pushBaseTint = function() {
                return that.pushBaseTint;
            };
            this._drawUniforms.u_pushSidesTint = function() {
                return that.pushSidesTint;
            };

        }

        this._oldUpdate(context, frameState, commandList);
    };

    
    // Intercepts the getShaderProgram function and replaces the current vertex and fragment shaders
    // allowing to push vertices and texture the push region.
    Cesium.CentralBodySurfaceShaderSet.prototype._oldGetShaderProgram = Cesium.CentralBodySurfaceShaderSet.prototype.getShaderProgram;
    Cesium.CentralBodySurfaceShaderSet.prototype.getShaderProgram = function(context, textureCount, applyBrightness, applyContrast, applyHue, applySaturation, applyGamma, applyAlpha) {
        // Text to replace is after the first occurance of '#line 0' but before the next occurance of '#line 0'
        var end = this.baseVertexShaderString.indexOf('#line 0', this.baseVertexShaderString.indexOf('#line 0') + 1);
        if (end < 0) {
            this.baseVertexShaderString = GroundPushCentralBodyVS;
        } else {
            this.baseVertexShaderString = GroundPushCentralBodyVS + this.baseVertexShaderString.substring(end);
        }

        end = this.baseFragmentShaderString.indexOf('#line 0', this.baseFragmentShaderString.indexOf('#line 0') + 1);
        if (end < 0) {
            this.baseFragmentShaderString = GroundPushCentralBodyFS;
        } else {
            this.baseFragmentShaderString = GroundPushCentralBodyFS + this.baseFragmentShaderString.substring(end);
        }

        return this._oldGetShaderProgram(context, textureCount, applyBrightness, applyContrast, applyHue, applySaturation, applyGamma, applyAlpha);
    };
    
    
    // Cesium.CentralBodySurface tweaking - adding uniforms and extra commands.
    Cesium.CentralBodySurface.prototype._oldUpdate = Cesium.CentralBodySurface.prototype.update;
    Cesium.CentralBodySurface.prototype.update = function(context, frameState, commandList, centralBodyUniformMap, shaderSet, renderState, projection) {
        // Call the original update
        this._oldUpdate(context, frameState, commandList, centralBodyUniformMap, shaderSet, renderState, projection);

        // Now modify the tile commands to include the required uniforms.
        var tileCommands = this._tileCommands;
        var realTileExtentFunc = function() { return this.realTileExtent; };
        var showOnlyInPushedRegionFunc = function() { return this.showOnlyInPushedRegion; };

        for (var i = 0; i < tileCommands.length; i++) {
            var uniformMap = tileCommands[i].uniformMap;

            if (!Cesium.defined(uniformMap.u_realTileExtent)) {
                uniformMap.u_realTileExtent = realTileExtentFunc;
            }
            if (!Cesium.defined(uniformMap.u_showOnlyInPushedRegion)) {
                uniformMap.u_showOnlyInPushedRegion = showOnlyInPushedRegionFunc;
            }
            if (!Cesium.defined(uniformMap.realTileExtent)) {
                uniformMap.realTileExtent = new Cesium.Cartesian4();
            }
            if (!Cesium.defined(uniformMap.showOnlyInPushedRegion)) {
                uniformMap.showOnlyInPushedRegion = [];
            }

            var realTileExtent = tileCommands[i].owner.extent;
            var numberOfDayTextures = 0;

            while (numberOfDayTextures < tileCommands[i].uniformMap.dayTextures.length) {
                var imageryLayer = tileCommands[i].owner.imagery[numberOfDayTextures].readyImagery.imageryLayer;
                if (typeof imageryLayer.showOnlyInPushedRegion !== 'undefined') {
                    uniformMap.showOnlyInPushedRegion[numberOfDayTextures] = imageryLayer.showOnlyInPushedRegion;
                } else {
                    uniformMap.showOnlyInPushedRegion[numberOfDayTextures] = 0.0;
                }
                ++numberOfDayTextures;
            }
            uniformMap.realTileExtent= new Cesium.Cartesian4(realTileExtent.west, realTileExtent.south, realTileExtent.east, realTileExtent.north);
        }
    };
    
    
    /**
     * HELPER FUNCTIONS
     */
    
    var quantizedStride = 3;
    var vertexStride = 6;
    var EPSILON6 = 0.000001;

    var xIndex = 0;
    var yIndex = 1;
    var zIndex = 2;
    var hIndex = 3;
    var uIndex = 4;
    var vIndex = 5;

    var indicesScratch = [];

    var cartesian3Scratch = new Cesium.Cartesian3();
    var cartographicScratch = new Cesium.Cartographic();

    /**
     * Inserts vertices to a given tile along the boundaries of the inner extent and outer extent
     * if either overlaps with the tileExtent.
     * 
     * @param  {Object} parameters The input parameters are:
     * parameters.innerExtent  the inner extent of the push region.
     * parameters.outerExtent  the outer extent of the push region.
     * parameters.vertices  the vertex buffer of the tile being modified.
     * parameters.indices  the index buffer of the tile being modified.
     * parameters.tileExtent  the extent of the tile being modified.
     * parameters.ellipsoid  the central body ellipsoid.
     * parameters.center  the center of the tile.
     * 
     * @return {Object}  The new vertex and index buffers.
     */
    function insertPushVertices(parameters) {
        var indices = indicesScratch;
        indices.length = 0;

        var newVerticesMap = {};

        var westOuterSliceValue = (parameters.outerExtent.west - parameters.tileExtent.west) / (parameters.tileExtent.east - parameters.tileExtent.west);
        var eastOuterSliceValue = (parameters.outerExtent.east - parameters.tileExtent.west) / (parameters.tileExtent.east - parameters.tileExtent.west);
        var northOuterSliceValue = (parameters.outerExtent.north - parameters.tileExtent.south) / (parameters.tileExtent.north - parameters.tileExtent.south);
        var southOuterSliceValue = (parameters.outerExtent.south - parameters.tileExtent.south) / (parameters.tileExtent.north - parameters.tileExtent.south);

        var westInnerSliceValue = (parameters.innerExtent.west - parameters.tileExtent.west) / (parameters.tileExtent.east - parameters.tileExtent.west);
        var eastInnerSliceValue = (parameters.innerExtent.east - parameters.tileExtent.west) / (parameters.tileExtent.east - parameters.tileExtent.west);
        var northInnerSliceValue = (parameters.innerExtent.north - parameters.tileExtent.south) / (parameters.tileExtent.north - parameters.tileExtent.south);
        var southInnerSliceValue = (parameters.innerExtent.south - parameters.tileExtent.south) / (parameters.tileExtent.north - parameters.tileExtent.south);

        var longSlicePlaneNormal = new Cesium.Cartesian3(1, 0, 0); // u unit normal vect. => vertical slice.
        var latSlicePlaneNormal = new Cesium.Cartesian3(0, 1, 0); // v unit normal vect. => horizontal slice.

        // The 8 slice planes that make up the extent, both inner and outer.
        var westOuterSlicePlane = new Cesium.Plane(longSlicePlaneNormal, -westOuterSliceValue);
        var eastOuterSlicePlane = new Cesium.Plane(longSlicePlaneNormal, -eastOuterSliceValue);
        var northOuterSlicePlane = new Cesium.Plane(latSlicePlaneNormal, -northOuterSliceValue);
        var southOuterSlicePlane = new Cesium.Plane(latSlicePlaneNormal, -southOuterSliceValue);

        var westInnerSlicePlane = new Cesium.Plane(longSlicePlaneNormal, -westInnerSliceValue);
        var eastInnerSlicePlane = new Cesium.Plane(longSlicePlaneNormal, -eastInnerSliceValue);
        var northInnerSlicePlane = new Cesium.Plane(latSlicePlaneNormal, -northInnerSliceValue);
        var southInnerSlicePlane = new Cesium.Plane(latSlicePlaneNormal, -southInnerSliceValue);

        var slicePlanes = [ westInnerSlicePlane,
                            eastInnerSlicePlane,
                            northInnerSlicePlane,
                            southInnerSlicePlane,
                            westOuterSlicePlane,
                            eastOuterSlicePlane,
                            northOuterSlicePlane,
                            southOuterSlicePlane ];

        var originalVertices = parameters.vertices;
        var originalIndices = parameters.indices;
        var center = parameters.center;

        var vertexCount = originalVertices.length / vertexStride;

        // Stores Cartesian versions of the vertices, with an added index property.
        var cartesianVertexBuffer = [];

        for (var i = 0, bufferIndex = 0; i < vertexCount; i++, bufferIndex += vertexStride) {
            // We're keeping all the original vertices...
            cartesianVertexBuffer.push(new Cesium.Cartesian3(originalVertices[bufferIndex + uIndex], originalVertices[bufferIndex + vIndex], originalVertices[bufferIndex + hIndex]));
            cartesianVertexBuffer[i].index = i;
        }

        // Copy the indices into an array.
        for (i = 0; i < originalIndices.length; i++) {
            indices.push(originalIndices[i]);
        }

        var tempIndices;

        for (var s = 0; s < slicePlanes.length; s++) {
            var numIndices = indices.length;
            tempIndices = [];

            for (i = 0; i < numIndices; i += quantizedStride) {
                // Iterate through all the triangles.
                var i0 = indices[i];
                var i1 = indices[i + 1];
                var i2 = indices[i + 2];

                var p0 = cartesianVertexBuffer[i0];
                var p1 = cartesianVertexBuffer[i1];
                var p2 = cartesianVertexBuffer[i2];

                // If the triangle intersects the plane this will return the following...
                // { positions : [p0, p1, p2, u1[, u2]],
                //   indices : [ ... ] }
                // Where u1 and u2 are the new vertices to be added to the triangle and
                // the indices identify the 3 triangles.
                var newTriangles = trianglePlaneIntersection(p0, p1, p2, slicePlanes[s]);
                // NOTE: If newTriangles is undefined then no new triangles are required.

                var newVertex1, newVertex2;
                if (Cesium.defined(newTriangles)) {
                    // Then there are potentially new vertices to be added...
                    if (newTriangles.positions.length === 5) { // TODO: Magic numbers...?
                        // 2 potential new vertices...
                        newVertex1 = newTriangles.positions[3];
                        newVertex2 = newTriangles.positions[4];

                        // Check which vertices are actually new. Both, one or neither...
                        if (!Cesium.defined(newVerticesMap[getKeyFromVertex(newVertex1)])) {
                            newVerticesMap[getKeyFromVertex(newVertex1)] = newVertex1;
                            newVertex1.index = cartesianVertexBuffer.length;
                            cartesianVertexBuffer.push(newVertex1);
                        } else {
                            newVertex1.index = newVerticesMap[getKeyFromVertex(newVertex1)].index;
                        }

                        if (!Cesium.defined(newVerticesMap[getKeyFromVertex(newVertex2)])) {
                            newVerticesMap[getKeyFromVertex(newVertex2)] = newVertex2;
                            newVertex2.index = cartesianVertexBuffer.length;
                            cartesianVertexBuffer.push(newVertex2);
                        } else {
                            newVertex2.index = newVerticesMap[getKeyFromVertex(newVertex2)].index;
                        }

                    } else if (newTriangles.positions.length === 4) { // TODO: Magic numbers...?
                        // 1 potential new vertex...

                        newVertex1 = newTriangles.positions[3];
                        // Check which vertices are actually new. Both, one or neither...
                        if (!Cesium.defined(newVerticesMap[getKeyFromVertex(newVertex1)])) {
                            newVerticesMap[getKeyFromVertex(newVertex1)] = newVertex1;
                            newVertex1.index = cartesianVertexBuffer.length;
                            cartesianVertexBuffer.push(newVertex1);
                        } else {
                            newVertex1.index = newVerticesMap[getKeyFromVertex(newVertex1)].index;
                        }

                    }

                    // Go through the new triangles adding them to the index buffer...
                    for (var j = 0; j < newTriangles.indices.length; j += 3) {
                        tempIndices.push(newTriangles.positions[newTriangles.indices[j]].index);
                        tempIndices.push(newTriangles.positions[newTriangles.indices[j + 1]].index);
                        tempIndices.push(newTriangles.positions[newTriangles.indices[j + 2]].index);
                    }

                } else {
                    // No new triangles... push the original indices onto the index buffer.
                    tempIndices.push(i0);
                    tempIndices.push(i1);
                    tempIndices.push(i2);
                }
            }
            indices = tempIndices;
        }


        var vertexBuffer = new Float32Array(cartesianVertexBuffer.length * vertexStride);
        var ellipsoid = parameters.ellipsoid;
        var tileExtent = parameters.tileExtent;
        var west = tileExtent.west;
        var south = tileExtent.south;
        var east = tileExtent.east;
        var north = tileExtent.north;

        // Make the full vertex buffer with new vertices included.
        for (i = 0, bufferIndex = 0; bufferIndex < vertexBuffer.length; ++i, bufferIndex += vertexStride) {
            cartographicScratch.longitude = lerp(west, east, cartesianVertexBuffer[i].x);
            cartographicScratch.latitude = lerp(south, north, cartesianVertexBuffer[i].y);
            cartographicScratch.height = cartesianVertexBuffer[i].z;

            ellipsoid.cartographicToCartesian(cartographicScratch, cartesian3Scratch);

            vertexBuffer[bufferIndex + xIndex] = cartesian3Scratch.x - center.x;
            vertexBuffer[bufferIndex + yIndex] = cartesian3Scratch.y - center.y;
            vertexBuffer[bufferIndex + zIndex] = cartesian3Scratch.z - center.z;
            vertexBuffer[bufferIndex + hIndex] = cartesianVertexBuffer[i].z;
            vertexBuffer[bufferIndex + uIndex] = cartesianVertexBuffer[i].x;
            vertexBuffer[bufferIndex + vIndex] = cartesianVertexBuffer[i].y;
        }

        var indicesTypedArray = new Uint16Array(indices);

        return {
            vertices : vertexBuffer.buffer,
            indices : indicesTypedArray.buffer
        };
    }

    /**
     * Returns a String key for a given vertex based on it's 3D position.
     * @param  {Cartesian3} vertex
     * @return {String}
     */
    function getKeyFromVertex(vertex) {
        return vertex.x.toString() + vertex.y.toString() + vertex.z.toString();
    }

    /**
     * Calculates the intersection of a line segment and a plane.
     * 
     * Taken from the Cesium.MeshTerrainData.
     */
    function lineSegmentPlane(endPoint0, endPoint1, plane, result) {
        if (!Cesium.defined(endPoint0)) {
            throw 'endPoint0 is required.';
        }
        if (!Cesium.defined(endPoint1)) {
            throw 'endPoint1 is required.';
        }
        if (!Cesium.defined(plane)) {
            throw 'plane is required.';
        }

        var difference = Cesium.Cartesian3.subtract(endPoint1, endPoint0);
        var normal = plane.normal;
        var nDotDiff = Cesium.Cartesian3.dot(normal, difference);

        // check if the segment and plane are parallel
        if (Math.abs(nDotDiff) < EPSILON6) {
            return undefined;
        }

        var nDotP0 = Cesium.Cartesian3.dot(normal, endPoint0);
        var t = -(plane.distance + nDotP0) / nDotDiff;

        // intersection only if t is in [0, 1]
        if (t < 0.0 || t > 1.0) {
            return undefined;
        }

        // intersection is endPoint0 + t * (endPoint1 - endPoint0)
        if (!Cesium.defined(result)) {
            result = new Cesium.Cartesian3();
        }
        Cesium.Cartesian3.multiplyByScalar(difference, t, result);
        Cesium.Cartesian3.add(endPoint0, result, result);
        return result;
    }

    /**
     * Calculates the intersection of a triangle (given by 3 vertices) and a plane.
     * 
     * Inspired by functions in Cesium.MeshTerrainData.
     */
    function trianglePlaneIntersection(p0, p1, p2, plane) {
        if ((!Cesium.defined(p0)) ||
            (!Cesium.defined(p1)) ||
            (!Cesium.defined(p2)) ||
            (!Cesium.defined(plane))) {
            throw 'p0, p1, p2, and plane are required.';
        }

        var planeNormal = plane.normal;
        var planeD = plane.distance;
        var normDotP0 = Cesium.Cartesian3.dot(planeNormal, p0);
        var normDotP1 = Cesium.Cartesian3.dot(planeNormal, p1);
        var normDotP2 = Cesium.Cartesian3.dot(planeNormal, p2);
        var p0Behind = (normDotP0 + planeD) < 0.0;
        var p1Behind = (normDotP1 + planeD) < 0.0;
        var p2Behind = (normDotP2 + planeD) < 0.0;
        var p0Infront = (normDotP0 + planeD) > 0.0;
        var p1Infront = (normDotP1 + planeD) > 0.0;
        var p2Infront = (normDotP2 + planeD) > 0.0;
        // Given these dots products, the calls to lineSegmentPlaneIntersection
        // always have defined results.

        var numBehind = 0;
        numBehind += p0Behind ? 1 : 0;
        numBehind += p1Behind ? 1 : 0;
        numBehind += p2Behind ? 1 : 0;

        var numInfront = 0;
        numInfront += p0Infront ? 1 : 0;
        numInfront += p1Infront ? 1 : 0;
        numInfront += p2Infront ? 1 : 0;

        var u1, u2;

        if (numInfront + numBehind !== 3) {
            // Then at least one point must lie on the plane...
            if (numInfront === numBehind && numInfront > 0) {
                u1 = new Cesium.Cartesian3();
                // then there must be one on the plane and one either side.
                // So we only need to split the triangle into 2 triangles...
                if (p0Behind) {
                    if (p1Infront) {
                        lineSegmentPlane(p0, p1, plane, u1);

                        return {
                            positions : [p0, p1, p2, u1 ],
                            indices : [
                                // Behind
                                0, 3, 2,

                                // In front
                                1, 2, 3
                            ]
                        };
                    } else if (p2Infront) {
                        lineSegmentPlane(p0, p1, plane, u1);

                        return {
                            positions : [p0, p1, p2, u1 ],
                            indices : [
                                // Behind
                                0, 1, 3,

                                // In front
                                1, 2, 3
                            ]
                        };
                    }
                } else if (p1Behind) {
                    if (p0Infront) {
                        lineSegmentPlane(p0, p1, plane, u1);

                        return {
                            positions : [p0, p1, p2, u1 ],
                            indices : [
                                // Behind
                                1, 2, 3,

                                // In front
                                0, 3, 2
                            ]
                        };
                    } else if (p2Infront) {
                        lineSegmentPlane(p0, p1, plane, u1);

                        return {
                            positions : [p0, p1, p2, u1 ],
                            indices : [
                                // Behind
                                1, 3, 0,

                                // In front
                                0, 3, 2
                            ]
                        };
                    }
                } else if (p2Behind) {
                    if (p0Infront) {
                        lineSegmentPlane(p0, p1, plane, u1);

                        return {
                            positions : [p0, p1, p2, u1 ],
                            indices : [
                                // Behind
                                1, 2, 3,

                                // In front
                                0, 1, 3
                            ]
                        };
                    } else if (p1Infront) {
                        lineSegmentPlane(p0, p1, plane, u1);

                        return {
                            positions : [p0, p1, p2, u1 ],
                            indices : [
                                // Behind
                                0, 3, 2,

                                // In front
                                0, 1, 3
                            ]
                        };
                    }
                }

            } else {
                // then the points could be in one of the following positions...
                //
                // 1. all points lie on the plane.
                // 2. 2 points lie on the plane and the other is on one side.
                // 3. 1 point lies on the plane and the others are both on one side.
                //
                // All of which do not require the original triangle to be split so
                // therefore no new vertices added...

                return undefined;
            }
        } else {
            u1 = new Cesium.Cartesian3();
            u2 = new Cesium.Cartesian3();
            // No points lie on the plane...
            if (numBehind === 1) {
                if (p0Behind) {
                    lineSegmentPlane(p0, p1, plane, u1);
                    lineSegmentPlane(p0, p2, plane, u2);

                    return {
                        positions : [p0, p1, p2, u1, u2 ],
                        indices : [
                            // Behind
                            0, 3, 4,

                            // In front
                            1, 2, 4,
                            1, 4, 3
                        ]
                    };
                } else if (p1Behind) {
                    lineSegmentPlane(p1, p2, plane, u1);
                    lineSegmentPlane(p1, p0, plane, u2);

                    return {
                        positions : [p0, p1, p2, u1, u2 ],
                        indices : [
                            // Behind
                            1, 3, 4,

                            // In front
                            2, 0, 4,
                            2, 4, 3
                        ]
                    };
                } else if (p2Behind) {
                    lineSegmentPlane(p2, p0, plane, u1);
                    lineSegmentPlane(p2, p1, plane, u2);

                    return {
                        positions : [p0, p1, p2, u1, u2 ],
                        indices : [
                            // Behind
                            2, 3, 4,

                            // In front
                            0, 1, 4,
                            0, 4, 3
                        ]
                    };
                }
            } else if (numBehind === 2) {
                if (!p0Behind) {
                    lineSegmentPlane(p1, p0, plane, u1);
                    lineSegmentPlane(p2, p0, plane, u2);

                    return {
                        positions : [p0, p1, p2, u1, u2 ],
                        indices : [
                            // Behind
                            1, 2, 4,
                            1, 4, 3,

                            // In front
                            0, 3, 4
                        ]
                    };
                } else if (!p1Behind) {
                    lineSegmentPlane(p2, p1, plane, u1);
                    lineSegmentPlane(p0, p1, plane, u2);

                    return {
                        positions : [p0, p1, p2, u1, u2 ],
                        indices : [
                            // Behind
                            2, 0, 4,
                            2, 4, 3,

                            // In front
                            1, 3, 4
                        ]
                    };
                } else if (!p2Behind) {
                    lineSegmentPlane(p0, p2, plane, u1);
                    lineSegmentPlane(p1, p2, plane, u2);

                    return {
                        positions : [p0, p1, p2, u1, u2 ],
                        indices : [
                            // Behind
                            0, 1, 4,
                            0, 4, 3,

                            // In front
                            2, 3, 4
                        ]
                    };
                }
            }
        }
    }
    
    /**
     * Linear interpolation helper function.
     */
    function lerp(p, q, time) {
        return ((1.0 - time) * p) + (time * q);
    }
};


/**
 * TODO: GroundPush setting functions... still in development.
 */

/**
 * Returns the actual inner extent of the push region.
 * @return {Extent}  The inner extent.
 */
GroundPush.prototype.getInnerExtent = function() {
    'use strict';
    return this._innerExtent;
};

/**
 * Sets the inner extent of the push region. Recalculates the outer extent automatically.
 * @param {Extent} newExtent  The new inner extent of the push region.
 */
GroundPush.prototype.setInnerExtent = function(newExtent) {
    'use strict';
    if (this.Cesium.defined(newExtent)) {
        this._innerExtent = newExtent;
        this.setOuterExtent();
    } else {
        var outerExtent = this._outerExtent;
        var width = outerExtent.east - outerExtent.west;
        var height = outerExtent.north - outerExtent.south;
        var pushBlend = this.pushBlend = this._pushBlendFraction * ((width < height) ? width : height);
        
        var innerExtent = this._innerExtent = outerExtent.clone();
        innerExtent.west += pushBlend;
        innerExtent.south += pushBlend;
        innerExtent.east -= pushBlend;
        innerExtent.north -= pushBlend;
    }
};

/**
 * Returns the actual outer extent of the push region.
 * @return {Extent}  The outer extent.
 */
GroundPush.prototype.getOuterExtent = function() {
    'use strict';
    return this._outerExtent;
};

/**
 * Sets the outer extent of the push region. Recalculates the inner extent automatically.
 * @param {Extent} newExtent  The new outer extent of the push region.
 */
GroundPush.prototype.setOuterExtent = function(newExtent) {
    'use strict';
    if (this.Cesium.defined(newExtent)) {
        this._outerExtent = newExtent;
        this.setInnerExtent();
    } else {
        var innerExtent = this._innerExtent;
        var width = innerExtent.east - innerExtent.west;
        var height = innerExtent.north - innerExtent.south;
        var pushBlend = this.pushBlend = this._pushBlendFraction * ((width < height) ? width : height);
        
        var outerExtent = this._outerExtent = innerExtent.clone();
        outerExtent.west -= pushBlend;
        outerExtent.south -= pushBlend;
        outerExtent.east += pushBlend;
        outerExtent.north += pushBlend;
    }
};