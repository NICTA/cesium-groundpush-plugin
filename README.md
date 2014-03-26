<p align="center">
<a href="http://cesium.agi.com/">
<img src="https://github.com/AnalyticalGraphicsInc/cesium/wiki/logos/Cesium_Logo_Color.jpg" width="50%" />
</a>
</p>

# Cesium Ground-Push Plugin
A plugin that enables "excavating" terrain of a defined extent within Cesium. It allows a user to define an extent and push the terrain within that region up or down. The pushed region can also be textured with a different terrain tile. This could potentially be used to visualise geospatial data or imagery in subsurface context.

## Cesium version
Only working with version [b26](http://cesiumjs.org/downloads.html). Does not work with previous versions.

## License
Apache 2.0. Free for commercial and non-commercial use. See [LICENSE.md](LICENSE.md).

## Usage

Checkout the demo in the [Example](Example) folder.

Include the following into your source:

```HTML
<script type="text/javascript" src="GroundPushCentralBodySurfaceShaderSet.js"></script>
<script type="text/javascript" src="GroundPushCentralBodyVS.js"></script>
<script type="text/javascript" src="GroundPushCentralBodyFS.js"></script>
<script type="text/javascript" src="GroundPush.js"></script>
```

Setup the options you require for the ground push:

```JavaScript
var options = {
	pushExtent : new Cesium.Extent( 0.0, 0.0, 0.1, 0.1 ),	// in radians
	pushDepth : -10000,										// in metres
	pushSidesTint : new Cesium.Cartesian3( 0.7, 0.6, 0.5 )	// rgb
};
```

Then initialise Ground-Push by passing in Cesium and options:

```JavaScript
var gp = new GroundPush(Cesium, options);
```

You can add an imagery layer to the push region by defining the `showOnlyInPushedRegion` on that imagery layer:

```JavaScript
var imageryLayers = centralBody.imageryLayers;
var imageryProvider = new Cesium.TileMapServiceImageryProvider({
	url : 'http://cesium.agi.com/blackmarble',
	maximumLevel : 8,
	credit : 'Black Marble imagery courtesy NASA Earth Observatory'
});
imageryLayers.addImageryProvider(imageryProvider);

// Define this property to limit the ImageryLayer to the push region.
imageryLayers.get(1).showOnlyInPushedRegion = 1.0;
```

You can change the push depth by accessing the `pushDepth` property of the GroundPush object:

```JavaScript
gp.pushDepth = -20000;
```

##Known Issues

 * Changing the push extent region once initialised does not work correctly.
 * Zooming too close to the pushed region - tiles within the push extent will disappear due to culling.
 * Horizon culling can be an issue at low angles.
