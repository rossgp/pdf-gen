

module.exports = {
	toRGB : function (n){
		var r = n >>> 16;
		var g = n >>> 8 & 0xFF;
		var b = n & 0xFF;
		return [r/255,g/255,b/255];
	},

	toCMYK : function (n){
		var c = n >>> 24;
		var m = n >>> 16 & 0xFF;	
		var y = n >>> 8 & 0xFF;
		var k = n & 0xFF;
		return [c/255,m/255,y/255,k/255];	
	},

	// Coverts array of color components to single number
	getColorNumber : function (color){
		if(color.length){
			var newColor = 0;
			for(var i in color){		
				newColor += (color[i] << ((color.length-i-1) * 8)) >>> 0;
			}
			return newColor;
		}
		return color;	
	},

	getAlignmentOffset : function (txt, options)
	{
		var offset = 0;
		if(options.align && options.width) {
			var dim = options.font.calculateTextDimensions(txt,options.size);
			var space = Math.max(options.width - dim.width, 0);
			offset = options.align == "right" ? space : (options.align == "centre" ? space / 2 : 0);
			
		}
		 return offset;
	},

	mergeTextOptions : function(source, dest)
	{
		source = source || {};
		
		var options = {
			font : dest.font || source.font,
			size : dest.size || source.size,
			colorspace : dest.colorspace || source.colorspace,
			color : dest.color || source.color,
			glyphs : dest.glyphs || source.glyphs,
			charspace : dest.charspace || source.charspace,
			align : dest.align || source.align,
			width : dest.width || source.width,
			lineHeight : dest.lineHeight || source.lineHeight
		}
		return options;
	},

	splitLines : function(txt, options)
	{
		if (!options.width || options.font.calculateTextDimensions(txt,options.size).width < options.width )
			return [txt];
		var words = txt.split(" ");
		var lines = [];
		var currentLine = "";

		for(var i in words){
			var word = words[i];
			var dim = options.font.calculateTextDimensions(word,options.size);
			var checkLine = currentLine ? currentLine + " " + word : word;
			if(options.font.calculateTextDimensions(checkLine,options.size).width > options.width){
				lines.push(currentLine);
				currentLine = word;
			} else {
				currentLine = checkLine;
			}
		}
		if(currentLine) {
			lines.push(currentLine);
		}
		return lines;
	},

	textHeight : function (font,size,txt) {
		var dim = font.calculateTextDimensions(txt,size);
		return dim.height
	}
};
