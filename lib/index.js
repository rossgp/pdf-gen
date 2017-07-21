var hummus = require('hummus'),
	utils = require('./utils'),
	debug = require('debug')('pdf-gen'),
    temp = require('temp');
  
var pageFormats = {
	"A3" : [842, 1191],
	"A4" : [595, 842],
	"A5" : [420, 595]
};

// Outer function to preserve private variables
var _PDFGen = (function(_pdfConfig, _options) {
	
var _writer, _page, _pageModifier, _pageIndex = 0,
	_pagecxt, _template, _header,_pages,_fonts,
	_styles, _fontLocations, _pageWidth, _pageHeight, _markup, _modifiedPageCount = 0,_links=[],_destination, _pdfData;

function PDFGen(pdfConfig, options){
	_template = pdfConfig.template;
	_header = pdfConfig.header || {};
	_pages = pdfConfig.pages || {};
	_styles = pdfConfig.styles || {};
	_fontLocations = pdfConfig.fonts || {};
	_markup = (options && options.markup) || function (template, data){ return template };

	var settings = pdfConfig.settings || {};

	var format = settings.format;
	// format can be explicit or a string of a predefined dimension (A4,A5 e.t.c).
	if(Array.isArray(format)){
		_pageWidth = format[0];
		_pageHeight = format[1];
	} else if(pageFormats[format]) {
		_pageWidth = pageFormats[format][0];
		_pageHeight = pageFormats[format][1];
	}
	_pageWidth = _pageWidth || pageFormats.A4[0];
	_pageHeight = _pageHeight || pageFormats.A4[1];

	if(settings.landscape){
		var tmp = _pageWidth;
		_pageWidth = _pageHeight;
		_pageHeight = tmp;
	}

	_pdfData = {};
}

PDFGen.prototype.generate = function(destination, pdfData) {
	var pageCount = _pages.length || 0;
    _destination=destination;
	var templateStream;
	var destStream
	debug('generate: destination: %s, data: \n%s',destination,  JSON.stringify(pdfData));
	
	if(typeof destination == 'object')
		destStream = new hummus.PDFStreamForResponse(destination);

	if(_template) {
		debug('generate: template : %s', _template);
		if(destStream) {
			templateStream = new hummus.PDFRStreamForFile(_template);
			_writer = hummus.createWriterToModify(templateStream, destStream);
		}
		else {
			_writer = hummus.createWriterToModify(_template, {modifiedFilePath : destination});
		}
		_modifiedPageCount = _writer.getModifiedFileParser().getPagesCount()
		pageCount = Math.max(pageCount, _modifiedPageCount);
	} else {	
		_writer = hummus.createWriter(destStream ? destStream : destination);				
	}
	loadFonts();

	_pdfData = pdfData;

	for(var n = 0; n <pageCount; n++){
		debug('generate: process page index %d', n);
		nextPage();
		var pageConfig = _pages[n];
		debug('generate: process page', pageConfig    );
		addItems(pageConfig, pdfData);
        writePage();
	};

	_writer.end();	
	
	if(templateStream)
		templateStream.close();
	
	if(typeof destination == 'object')
		destination.end();

    if (_links.length > 0){
        var newPDFFile=mergeLinksPage();
        if (newPDFFile){
            return newPDFFile;
        }

    }
}

function loadFonts() {
	_fonts = {};
	for (font in _fontLocations)
	{
		_fonts[font] = _writer.getFontForFile(_fontLocations[font]);
	};		
}

function addImage(parent, data, item) {
	var options = { transformation : {
		width : item.width,
		height : item.height,
		proportional : item.proportional
	}};
	_pagecxt.drawImage(getXPos(parent, item, data), getYPos(parent, item, data), item.location, options);
}

function addItems(parent, data) {
	if(!(parent && parent.items))
		return;
	var items = parent.items;
	for(var i in items){
		var item = items[i];
		var type = item.type ? item.type : "text"; // default type.
		if(parent.style && !item.style)
			item.style = item.style || parent.style;
		debug('addItems: type %s', type);
		switch(type)
		{
			case 'text':
				addText(parent, data,item);	
				break;
            case 'link':
                addLink(parent, data,item);
                break;
			case 'image':
				addImage(parent,data, item);	
				break;
			case 'table':
				addTable(parent, data,item);
				break;
			case 'block':	
				if(!item.condition || _markup(item.condition, data)){
					addItems(item, data);
				};
				break;
			default:
				addShape(parent, data, item);			
				break;
		};
	};
};

function addRow(table, row, yOffset, data){
	var x = table.x;
	var y = table.y - yOffset;
	var yOffsetAdjustment = 0;
	for(var i in row){
		var options = utils.mergeTextOptions(table.textDefaults, row[i]);
		options.x = x;
		options.y = y;
		options.text = row[i].text;
		debug('x', x);
		// Determine the largest adjustment applied to the row.
		yOffsetAdjustment= Math.max(addText(null, data, options), yOffsetAdjustment);
		x += (options.width || 0) + (options.columnSpacing || 0);
		debug('x2', x, options.width, options.columnSpacing);
	};
	debug('yOffsetAdjustment', yOffsetAdjustment, table.rowOffset);
	return yOffsetAdjustment + table.rowOffset;
};

function index(obj,i) {return obj[i]};

function addTable(parent, data, table){
	var yOffset = 0;
	if(table.header) {
		yOffset += addRow(table, table.header, yOffset, data);
	}

	function newPage(i) {
		if(i==0)
			return false;
		if(table.rowsPerPage && i % table.rowsPerPage == 0)
			return true;
		// new page if next row is at bottom of the page.
		if((table.y - yOffset) < (table.rowOffset + (table.bottomMargin || 30)))
			return true;
    return false;
	}

	var rowData = table.data && table.data.split('.').reduce(index, data) || {};

	for(var i in rowData){
		if(newPage(i)){
			if (table.continueText) {
				addText(data, table.continueText);
			}
			writePage();
			nextPage(); // TODO inserting page if we're modifying existing?
			yOffset = 0;
			if(table.header) {

				yOffset += addRow(table, table.header, yOffset, data);
			}

		};
		yOffset += addRow(table, table.row, yOffset, rowData[i]);
	};	
};

	function drawPath(item, xPos, yPos, options){
		var args = [xPos,yPos];
		options.close = item.close;
		for(var i in item.points) {
			args.push(xPos + item.points[i][0]);
			args.push(yPos - item.points[i][1]);
		}
		args.push(options);
		_pagecxt.drawPath.apply(_pagecxt, args);
	}

function addShape(parent, data, item){
	var options = {
		color : utils.getColorNumber(item.color || 0),
		size : item.size,
		colorspace : item.colorspace|| "rgb",
		type : item.fill ? "fill" : "stroke"
	};	
	var xPos = getXPos(parent, item, data);
	var yPos = getYPos(parent, item, data);
	
	switch(item.type)
	{
		case 'rect':
			_pagecxt.drawRectangle(xPos,yPos,item.width,item.height,options);
			break;
		case 'square':
			_pagecxt.drawSquare(xPos,yPos,item.width,options);
			break;
		case 'circle':
			_pagecxt.drawCircle(xPos,yPos,item.radius,options);
			break;
		case 'path':
			drawPath(item, xPos, yPos,options);
			break;
	};
}

function writeText(txt, x, y, options){
	// We can use built-in text writer except for these options.
	if(options.glyphs || options.charspace){
		_pagecxt.BT().Tm(1,0,0,1, x, y).Tf(options.font,options.size);
		
		if(!options.colorspace || options.colorspace === "rgb"){
			var rgb = utils.toRGB(options.color);
			_pagecxt.rg(rgb[0],rgb[1], rgb[2]);
		}
		else if (options.colorspace === "cmyk") {
			var cmyk = utils.toCMYK(options.color);
			_pagecxt.k(cmyk[0],cmyk[1], cmyk[2], cmyk[3]);
		}
		else if (options.colorspace === "grey") {
			_pagecxt.g(options.color/255);
		}
		if(options.charspace) {
			_pagecxt.Tc(options.charspace);
		}
		if(options.glyphs) {		
			for(var c in txt){
				var ch =  txt[c];
            if(options.glyphs[ch]) {
					_pagecxt.Tj([[options.glyphs[ch], ch.charCodeAt(0)]]); 
				} else {
					_pagecxt.Tj(ch);
				}
			};	
		} else {
			_pagecxt.Tj(txt);
		};
		_pagecxt.ET();
	}
	else {
		_pagecxt.writeText(txt, x, y, options);
	};
}

function toNumber(item, data) {

	if (item == null) {
		return null;
	}

	// if we are using markup to template the value (e.g. x,y position)
	// then the value from the template will be a string value, this
	// needs to be converted to a number after it has been processed 
	// by the markup code.
	// 
	if ((typeof item) === "string") {		
		return parseInt(_markup(item, data));		
	}

	// otherwise assume not-templated item return as is.
	return item;
}

function getXPos(parent, item, data) {
	return toNumber(item.x, data) || (parent && toNumber(parent.x, data)) + (item.xOffset || 0);
}

function getYPos(parent, item, data) {

	return toNumber(item.y, data) || (parent && toNumber(parent.y, data)) + (item.yOffset || 0);
}

function getRectWidth(parent, item) {
        return item.rectWidth || (parent && parent.rectWidth) + (item.yOffset || 0);
}

function getRectHeight(parent, item) {
        return item.rectHeight || (parent && parent.rectHeight) + (item.yOffset || 0);
}


function addText(parent, data, item){
	var printTxt = _markup(item.text, data);
	if(!printTxt)
		return 0;
	
	var style = _styles[item.style];
	if(!style && !item.font) {
		style = _styles["default"];
	}

	var options = utils.mergeTextOptions(style, item);
	options.font = _fonts[options.font];
	options.size = options.size || 10;	
	options.colorspace = options.colorspace || "rgb";		
	options.color = utils.getColorNumber(options.color || 0);
	
	var lines = utils.splitLines(printTxt, options);
	
	var xPos = getXPos(parent, item, data);
	var yPos = getYPos(parent, item, data);

	var yOffset = 0;
	
	for(var i in lines){
		var txt = lines[i];

		var xOffset = utils.getAlignmentOffset(txt, options);
		if(item.spacing){
			// Each char in text will be added with the spacing specified.
			// TODO the alignment will be off as its calculated for whole text.
			for(var c in txt){
				writeText(txt[c], xPos + xOffset + item.spacing * c, yPos + yOffset, options);
			};	
		} else {			
			writeText(txt, xPos + xOffset, yPos + yOffset, options);
		};
		
		yOffset -= options.lineHeight;
	};
	
	if(item.border) {
		var borderWidth = item.border.width ? item.border.width : 4;
	
		var x = xPos-borderWidth, y = yPos+borderWidth, 
				width = item.width + borderWidth * 2,
				height = textHeight(options.font,item.size,printTxt) + borderWidth * 2;
		var bOptions = item.border;
		bOptions.type = "stroke";		

		_pagecxt.drawRectangle(x, y, width, height, bOptions);						
	};
	// Return the extra height due to wrapping
	return Math.max(0,(lines.length - 1)) * (options.lineHeight || 0);
};

function addLink(parent,data,item){
	debug('addLink: item:', item);

    var rectBottomLeftX = getXPos(parent, item, data);
    var rectBottomLeftY = getYPos(parent, item, data);
    var rectWidth       = getRectWidth(parent,item);
    var rectHeight      = getRectHeight(parent,item);
    var pageNumber      = item.pageNumber||0;
    var printTxt        = _markup(item.text, data);

    _links.push({link:printTxt,
                 rectBottomLeftX:rectBottomLeftX,
                 rectBottomLeftY:rectBottomLeftY,
                 rectWidth:rectWidth,
                 rectHeight:rectHeight,
                 pageNumber:pageNumber});

}

/*
  When there are links, we create a new page(s), populate the links and finally merge
  the new PDF document with the already generated PDF document.
*/
function mergeLinksPage()
    {
		debug('mergeLinksPage: link count %d:', _links.length);
        if (_links.length > 0){

        var newPDFFile = temp.path({suffix : ".pdf"});
        var pdfWriter = hummus.createWriter(newPDFFile);
        for (var y=0; y < _modifiedPageCount;y++){
                var page = pdfWriter.createPage(0,0,595,842);
                var contentContext = pdfWriter.startPageContentContext(page).q()
                                                                            .cm(1,0,0,1,0,0);
                for (var i in _links){
                    var url=_links[i].link;
                    if (_links[i].pageNumber===y){
                        pdfWriter.pausePageContentContext(contentContext)
                                 .attachURLLinktoCurrentPage(_links[i].link,
                                                             _links[i].rectBottomLeftX,
                                                             _links[i].rectBottomLeftY,
                                                             _links[i].rectWidth,
                                                             _links[i].rectHeight);
                    }
                }
                var pageIndex = 0;
                pdfWriter.mergePDFPagesToPage(page,
                                              _destination,
                                              {type:hummus.eRangeTypeSpecific,specificRanges:[[y,y]]},
                                              function()
                                              {
                                                if(0 == pageIndex)
                                                {
                                                    contentContext.Q()
                                                                  .q()
                                                                  .cm(0.5,0,0,0.5,0,421);
                                                }
                                                    ++pageIndex;
                                              }
                                             );
                contentContext.Q();
                if (y===_modifiedPageCount-1){
                    _links=[];
                    pdfWriter.writePage(page).end();
                    return newPDFFile;
                }else{
                    pdfWriter.writePage(page);
                }
            }
        }
    }


function writePage(){
	debug('writePage: _pageModifier = ', _pageModifier && true);
	if(_pageModifier) {
        _pageModifier.endContext().writePage();
		_pageModifier = null;

	}
	else
    	_writer.writePage(_page)
}

function nextPage(){
	debug('nextPage:');
	if(_template && _modifiedPageCount > _pageIndex) {
		_pageModifier = new hummus.PDFPageModifier(_writer,_pageIndex);
		_pagecxt = _pageModifier.startContext().getContext();
	} else {
		_page = _writer.createPage(0, 0, _pageWidth, _pageHeight);	
		_pagecxt = _writer.startPageContentContext(_page);
	}
	_pageIndex++;
	debug('generate: process header', _header);
	addItems(_header, _pdfData);
}

	return new PDFGen(_pdfConfig, _options);
});

module.exports=_PDFGen;
