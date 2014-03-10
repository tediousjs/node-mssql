FIGURE =
	INTERIOR_RING: 0x00
	STROKE: 0x01
	EXTERIOR_RING: 0x02

FIGURE_V2 =
	POINT: 0x00
	LINE: 0x01
	ARC: 0x02
	COMPOSITE_CURVE: 0x03

SHAPE =
	POINT: 0x01
	LINESTRING: 0x02
	POLYGON: 0x03
	MULTIPOINT: 0x04
	MULTILINESTRING: 0x05
	MULTIPOLYGON: 0x06
	GEOMETRY_COLLECTION: 0x07

SHAPE_V2 =
	POINT: 0x01
	LINESTRING: 0x02
	POLYGON: 0x03
	MULTIPOINT: 0x04
	MULTILINESTRING: 0x05
	MULTIPOLYGON: 0x06
	GEOMETRY_COLLECTION: 0x07
	CIRCULAR_STRING: 0x08
	COMPOUND_CURVE: 0x09
	CURVE_POLYGON: 0x0A
	FULL_GLOBE: 0x0B

SEGMENT =
	LINE: 0x00
	ARC: 0x01
	FIRST_LINE: 0x02
	FIRST_ARC: 0x03

class Point
	x: 0
	y: 0
	z: null
	m: null

parseGeography = (buffer, geometry = false) ->
	# s2.1.1 + s.2.1.2
		
	srid = buffer.readInt32LE 0
	if srid is -1 then return null
	
	value =
		srid: srid
		version: buffer.readUInt8 4
		
	flags = buffer.readUInt8 5
	buffer.position = 6
	
	#console.log "srid", srid
	#console.log "version", version
	
	properties =
		Z: if flags & (1 << 0) then true else false
		M: if flags & (1 << 1) then true else false
		V: if flags & (1 << 2) then true else false
		P: if flags & (1 << 3) then true else false
		L: if flags & (1 << 4) then true else false
	
	if value.version is 2
		properties.H = if flags & (1 << 3) then true else false
		
	#console.log "properties", properties
	
	if properties.P
		numberOfPoints = 1
	else if properties.L
		numberOfPoints = 2
	else
		numberOfPoints = buffer.readUInt32LE buffer.position
		buffer.position += 4
	
	#console.log "numberOfPoints", numberOfPoints
	
	value.points = parsePoints buffer, numberOfPoints
	
	if properties.Z
		parseZ buffer, value.points
	
	if properties.M
		parseM buffer, value.points
	
	#console.log "points", points
	
	if properties.P
		numberOfFigures = 1
	else if properties.L
		numberOfFigures = 1
	else
		numberOfFigures = buffer.readUInt32LE buffer.position
		buffer.position += 4
		
	#console.log "numberOfFigures", numberOfFigures
	
	value.figures = parseFigures buffer, numberOfFigures, properties
	
	#console.log "figures", figures
	
	if properties.P
		numberOfShapes = 1
	else if properties.L
		numberOfShapes = 1
	else
		numberOfShapes = buffer.readUInt32LE buffer.position
		buffer.position += 4
		
	#console.log "numberOfShapes", numberOfShapes
	
	value.shapes = parseShapes buffer, numberOfShapes, properties

	#console.log "shapes", shapes
	
	if value.version is 2
		numberOfSegments = buffer.readUInt32LE buffer.position
		buffer.position += 4
		
		#console.log "numberOfSegments", numberOfSegments
		
		value.segments = parseSegments buffer, numberOfSegments

		#console.log "segments", segments
	
	else
		value.segments = []
	
	value

parsePoints = (buffer, count) ->
	# s2.1.5 + s2.1.6
	
	points = []
	if count < 1 then return points
	
	for i in [1..count]
		points.push (point = new Point)
		point.x = buffer.readDoubleLE buffer.position
		point.y = buffer.readDoubleLE buffer.position + 8
		buffer.position += 16
	
	points

parseZ = (buffer, points) ->
	# s2.1.1 + s.2.1.2
	
	if points < 1 then return
	
	for point in points
		point.z = buffer.readDoubleLE buffer.position
		
		buffer.position += 8
	
parseM = (buffer, points) ->
	# s2.1.1 + s.2.1.2
	
	if points < 1 then return
	
	for point in points
		point.m = buffer.readDoubleLE buffer.position
		
		buffer.position += 8

parseFigures = (buffer, count, properties) ->
	# s2.1.3
	
	figures = []
	if count < 1 then return figures
	
	if properties.P
		figures.push
			attribute: 0x01
			pointOffset: 0
			
	else if properties.L
		figures.push
			attribute: 0x01
			pointOffset: 0
			
	else
		for i in [1..count]
			figures.push
				attribute: buffer.readUInt8 buffer.position
				pointOffset: buffer.readInt32LE buffer.position + 1
			
			buffer.position += 5
	
	figures

parseShapes = (buffer, count, properties) ->
	# s2.1.4
	
	shapes = []
	if count < 1 then return shapes
	
	if properties.P
		shapes.push
			parentOffset: -1
			figureOffset: 0
			type: 0x01

	else if properties.L
		shapes.push
			parentOffset: -1
			figureOffset: 0
			type: 0x02

	else
		for i in [1..count]
			shapes.push
				parentOffset: buffer.readInt32LE buffer.position
				figureOffset: buffer.readInt32LE buffer.position + 4
				type: buffer.readUInt8 buffer.position + 8
			
			buffer.position += 9
	
	shapes

parseSegments = (buffer, count) ->
	# s2.1.7
	
	segments = []
	if count < 1 then return segments
	
	for i in [1..count]
		segments.push
			type: buffer.readUInt8 buffer.position
		
		buffer.position++
	
	segments

exports.PARSERS =
	geography: (buffer) ->
		parseGeography buffer
	
	geometry: (buffer) ->
		parseGeography buffer, true