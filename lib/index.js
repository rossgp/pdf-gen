var hummus = require('hummus');
	  utils = require('./utils'),
    temp=require('temp');
  
var pageFormats = {
	"A3" : [842, 1191],
	"A4" : [595, 842],
	"A5" : [420, 595]
}

// Outer function to preserve private variables
var _PDFGen = (function(_pdfConfig, _options) {
	
var _writer, _page, _pageModifier, _pageIndex = 0,
	_pagecxt, _template, _header,_pages,_fonts,
	_styles, _fontLocations, _pageWidth, _pageHeight, _markup, _modifiedPageCount = 0,_links=[],_destination;

function PDFGen(pdfConfig, options){
	_template = pdfConfig.template;	
	_header = pdfConfig.header || {};
	_pages = pdfConfig.pages || {};
	_styles = pdfConfig.styles || {};
	_fontLocations = pdfConfig.fonts || {};
	_markup = (options && options.markup) || function (template, data){ return template };
	
	var format = pdfConfig.settings ? pdfConfig.settings.format : "";
	if(pageFormats[format]) {
		_pageWidth = pageFormats[format][0];
		_pageHeight = pageFormats[format][1];
	}
	_pageWidth = _pageWidth || pageFormats.A4[0];
	_pageHeight = _pageHeight || pageFormats.A4[1];
}

PDFGen.prototype.generate = function(destination, pdfData) {
	var pageCount = _pages.length || 0;
    _destination=destination;
	var templateStream;
	var destStream
	
	if(typeof destination == 'object')
		destStream = new hummus.PDFStreamForResponse(destination);

	if(_template) { 		
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
	
	for(var n = 0; n <pageCount; n++){
		nextPage();
		addItems(_header, pdfData);
		var pageConfig = _pages[n];
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

function addImage(parent, item) {
	var options = { transformation : {
		width : item.width,
		height : item.height,
		proportional : item.proportional
	}};
	_pagecxt.drawImage(getXPos(parent, item), getYPos(parent, item), item.location, options);
}

function addItems(parent, data) {
	if(!(parent && parent.items))
		return;
	var items = parent.items;
	for(var i in items){
		var item = items[i];
		var type = item.type ? item.type : "text"; // default type.
		switch(type)
		{
			case 'text':
				addText(parent, data,item);	
				break;
            case 'link':
                addLink(parent, data,item);
                break;
			case 'image':
				addImage(parent, item);	
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
				addShape(parent, item);			
				break;
		};
	};
};

function addRow(table, row, yOffset, data){
	var x = table.x;
	var y = table.y - yOffset;
	for(var i in row){
		var options = utils.mergeTextOptions(table.textDefaults, row[i]);
		
		options.x = x;
		options.y = y;
		options.text = row[i].text;

		addText(null, data, options);	
		x += options.width || 0;
	};
};

function index(obj,i) {return obj[i]};

function addTable(parent, data, table){
	if(table.header)
		addRow(table, table.header, 0, data);

	var rowData = table.data && table.data.split('.').reduce(index, data) || {};

	var yOffset = 0;
	for(var i in rowData){
		if(i > 0 && i % table.rowsPerPage == 0){
			addText(data, table.continueText);
			writePage();
			nextPage(); // TODO inserting page if we're modifying existing?
			addRow(table, table.header, 0, data);
			yOffset = 0;
		};
		addRow(table, table.row, yOffset, rowData[i]);		
		yOffset += table.rowOffset;
	};	
};

function addShape(parent, item){
	var options = {
		color : utils.getColorNumber(item.color || 0),
		size : item.size,
		colorspace : item.colorspace|| "rgb",
		type : item.fill ? "fill" : "stroke"
	};	
	var xPos = getXPos(parent, item);
	var yPos = getYPos(parent, item);
	
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

function getXPos(parent, item) {
	return item.x || (parent && parent.x) + (item.xOffset || 0);
}

function getYPos(parent, item) {
	return item.y || (parent && parent.y) + (item.yOffset || 0);
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
		return
	
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
	
	var xPos = getXPos(parent, item);
	var yPos = getYPos(parent, item);

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
};

function addLink(parent,data,item){

    var rectBottomLeftX = getXPos(parent, item);
    var rectBottomLeftY = getYPos(parent, item);
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
	if(_pageModifier) {
        _pageModifier.endContext().writePage();
		_pageModifier = null;

	}
	else
    _writer.writePage(_page)
}

function nextPage(){
	if(_template && _modifiedPageCount > _pageIndex) {
		_pageModifier = new hummus.PDFPageModifier(_writer,_pageIndex);
		_pagecxt = _pageModifier.startContext().getContext();
	} else {
		_page = _writer.createPage(0, 0, _pageWidth, _pageHeight);	
		_pagecxt = _writer.startPageContentContext(_page);


	}
	_pageIndex++;
}

	return new PDFGen(_pdfConfig, _options);
});

module.exports=_PDFGen;
