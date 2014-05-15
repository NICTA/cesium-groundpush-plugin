<p align="center">
<a href="http://cesium.agi.com/">
<img src="https://github.com/AnalyticalGraphicsInc/cesium/wiki/logos/Cesium_Logo_Color.jpg" width="50%" />
</a>
</p>

# Cesium Ground-Push Plugin
A plugin that enables "excavating" terrain of a defined rectangle within Cesium. It allows a user to define an rectangle and push the terrain within that region up or down. The pushed region can also be textured with a different terrain tile. This could potentially be used to visualise geospatial data or imagery in subsurface context. Checkout the [demo](http://nicta.github.io/cesium-groundpush-plugin/example/).

## Cesium version
Currently working with version [b27](http://cesiumjs.org/downloads.html). For earlier Cesium releases, please check the Ground-Push Plugin [releases](releases).

## License
Apache 2.0. Free for commercial and non-commercial use. See [LICENSE.md](LICENSE.md).

## Usage

Include the following into your source:

```HTML
<script type="text/javascript" src="[your path to Cesium]/Cesium.js"></script>
<script type="text/javascript" src="GroundPushGlobeSurfaceShaderSet.js"></script>
<script type="text/javascript" src="GroundPushGlobeVS.js"></script>
<script type="text/javascript" src="GroundPushGlobeFS.js"></script>
<script type="text/javascript" src="GroundPush.js"></script>
```

Before you do __anything__ with Cesium you must setup and initialise the Ground-Push plugin.

First, setup the options you require for the ground-push. Currently these include:

* `pushDepth` - The intial height of the push region in metres.
* `pushRectangle` - __Required__: A Cesium Rectangle of the region to be pushed.
* `pushBaseTint` - A Cesium Cartesian3 representing the RGB colour tint of the base of the pushed region. 
* `pushSidesTint` - A Cesium Cartesian3 representing the RGB colour tint of the sides of the pushed region.

E.g.

```JavaScript
var options = {
	pushRectangle : new Cesium.Rectangle( 0.0, 0.0, 0.1, 0.1 ),	// in radians
	pushDepth : -10000,										// in metres
	pushSidesTint : new Cesium.Cartesian3( 0.7, 0.6, 0.5 )	// rgb
};
```

Then initialise ground-push by passing in Cesium and options:

```JavaScript
var gp = new GroundPush(Cesium, options);
```

If you want to apply a different texture to the pushed region you can use a Cesium Imagery Layer. Create it and add it as [usual](http://cesiumjs.org/Cesium/Apps/Sandcastle/index.html?src=Imagery%20Layers.html&label=All), then define the `showOnlyInPushedRegion` to `true` on that layer:

```JavaScript
var imageryLayers = globe.imageryLayers;
var imageryProvider = new Cesium.TileMapServiceImageryProvider({
	url : 'http://cesium.agi.com/blackmarble',
	maximumLevel : 8,
	credit : 'Black Marble imagery courtesy NASA Earth Observatory',

    // Limit the rectangle of the imagery layer so that tiles
    // that will never be visible aren't loaded.
    rectangle : gp.getOuterRectangle()
});
imageryLayers.addImageryProvider(imageryProvider);

// Define this property to limit the ImageryLayer to the push region.
imageryLayers.get(1).showOnlyInPushedRegion = true;
```

You can change the push depth at any time simply by accessing the `pushDepth` property of the GroundPush object:

```JavaScript
gp.pushDepth = -20000;
```

Currently, however, you cannot change the push rectangle once ground-push has been initialised.

##Known Issues

 * Zooming too close to the pushed region - tiles within the push rectangle will disappear due to culling.
 * Horizon culling can be an issue at low angles.
 * Changing the push rectangle region once initialised does not work correctly.
